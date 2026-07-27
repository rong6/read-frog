/**
 * Dashboard side of the bridge. Bundled into the dashboard build only.
 *
 * Presents the same async key-value + fetch surface the userscript has, so the
 * dashboard's `#imports` shim can be written against it without caring that the
 * real work happens in another script context.
 */

import type { BridgeFetchRequest, BridgeFetchResult, BridgeMethod, BridgeResponse } from "./protocol"
import { BRIDGE_CHANNEL, BRIDGE_TIMEOUT_MS, isBridgeMessage } from "./protocol"

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void }

const pending = new Map<number, Pending>()
const valueWatchers = new Map<string, Set<(newValue: unknown, oldValue: unknown, remote: boolean) => void>>()

let counter = 0
let ready = false
let listenerInstalled = false
const readyWaiters: (() => void)[] = []

function ensureListener() {
  if (listenerInstalled) return
  listenerInstalled = true

  window.addEventListener("message", (event) => {
    if (event.source !== window) return
    if (event.origin !== location.origin) return
    if (!isBridgeMessage(event.data)) return

    if (event.data.kind === "response") {
      const response = event.data as BridgeResponse
      const entry = pending.get(response.id)
      if (!entry) return
      pending.delete(response.id)
      if (response.ok) entry.resolve(response.value)
      else entry.reject(new Error(response.error ?? "Bridge request failed"))
      return
    }

    if (event.data.kind === "event") {
      if (event.data.name === "ready") {
        if (!ready) {
          ready = true
          for (const waiter of readyWaiters.splice(0)) waiter()
        }
        return
      }
      if (event.data.name === "valueChange") {
        const { key, newValue, oldValue, remote } = event.data.payload as {
          key: string
          newValue: unknown
          oldValue: unknown
          remote: boolean
        }
        for (const handler of valueWatchers.get(key) ?? []) {
          try {
            handler(newValue, oldValue, remote)
          } catch (error) {
            console.error("[read-frog] bridge watcher threw", error)
          }
        }
      }
    }
  })
}

function call<T>(method: BridgeMethod, ...args: unknown[]): Promise<T> {
  ensureListener()
  const id = ++counter

  const promise = new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
    window.postMessage(
      { channel: BRIDGE_CHANNEL, kind: "request", id, method, args },
      location.origin,
    )

    const timeout = BRIDGE_TIMEOUT_MS[method]
    if (Number.isFinite(timeout)) {
      setTimeout(() => {
        if (!pending.has(id)) return
        pending.delete(id)
        reject(
          new Error(
            "The Read Frog userscript did not respond. Make sure it is installed and that this " +
              "page's address matches the dashboard URL configured in the script.",
          ),
        )
      }, timeout)
    }
  })

  return Object.assign(promise, { requestId: id }) as Promise<T> & { requestId: number }
}

/** Resolves once the userscript has announced itself, or rejects after `timeoutMs`. */
export function waitForBridge(timeoutMs = 4000): Promise<void> {
  ensureListener()
  if (ready) return Promise.resolve()

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("bridge-timeout")), timeoutMs)
    readyWaiters.push(() => {
      clearTimeout(timer)
      resolve()
    })
    // The userscript may have announced before we started listening; poke it.
    void call("handshake").then(
      () => {
        if (ready) return
        ready = true
        clearTimeout(timer)
        resolve()
      },
      () => {},
    )
  })
}

export function isBridgeReady(): boolean {
  return ready
}

/**
 * Flatten whatever `fetch` was called with into something structured clone can
 * carry. `Request` objects matter here: oRPC's `RPCLink` and better-auth both
 * hand their transport a fully-built `Request` with the method, headers and
 * body on it and an almost-empty `init` — reading only `init` would ship a bare
 * bodyless GET, which is exactly what used to happen.
 */
async function flattenRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  responseType: "text" | "base64",
): Promise<BridgeFetchRequest> {
  const isRequest = typeof Request !== "undefined" && input instanceof Request

  const url = isRequest ? input.url : input instanceof URL ? input.href : String(input)
  const method = (init?.method ?? (isRequest ? input.method : undefined) ?? "GET").toUpperCase()

  const headers: [string, string][] = []
  const merged = new Headers(isRequest ? input.headers : undefined)
  new Headers(init?.headers).forEach((value, key) => merged.set(key, value))
  merged.forEach((value, key) => headers.push([key, value]))

  let body: string | undefined
  if (typeof init?.body === "string") {
    body = init.body
  } else if (init?.body instanceof URLSearchParams) {
    body = init.body.toString()
  } else if (init?.body != null) {
    body = await new Response(init.body as BodyInit).text()
  } else if (isRequest && method !== "GET" && method !== "HEAD") {
    const text = await input.clone().text()
    body = text.length > 0 ? text : undefined
  }

  return {
    url,
    method,
    headers,
    body,
    credentials: init?.credentials ?? (isRequest ? input.credentials : undefined),
    redirect: init?.redirect ?? (isRequest ? input.redirect : undefined),
    responseType,
  }
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

async function relayFetch(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  responseType: "text" | "base64",
): Promise<Response> {
  const request = await flattenRequest(input, init, responseType)
  const promise = call<BridgeFetchResult>("fetch", request) as Promise<BridgeFetchResult> & {
    requestId: number
  }

  // Relay cancellation. Without this a card the user has already navigated away
  // from keeps its provider request running to completion.
  const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
  const onAbort = () => {
    void call("abortFetch", promise.requestId).catch(() => {})
  }
  if (signal) {
    if (signal.aborted) {
      onAbort()
      throw new DOMException("The operation was aborted.", "AbortError")
    }
    signal.addEventListener("abort", onAbort, { once: true })
  }

  try {
    const result = await promise
    const body =
      result.bodyEncoding === "base64"
        ? (decodeBase64(result.body) as unknown as BodyInit)
        : result.body
    return new Response(result.status === 204 || result.status === 304 ? null : body, {
      status: result.status,
      statusText: result.statusText,
      headers: new Headers(result.headers),
    })
  } finally {
    signal?.removeEventListener("abort", onAbort)
  }
}

export const bridge = {
  getValue: <T>(key: string, fallback?: T) => call<T | undefined>("getValue", key, fallback),
  setValue: (key: string, value: unknown) => call<boolean>("setValue", key, value),
  deleteValue: (key: string) => call<boolean>("deleteValue", key),
  listValues: () => call<string[]>("listValues"),
  openInTab: (url: string, active = true) => call<boolean>("openInTab", url, active),

  watch(
    key: string,
    handler: (newValue: unknown, oldValue: unknown, remote: boolean) => void,
  ): () => void {
    let handlers = valueWatchers.get(key)
    if (!handlers) {
      handlers = new Set()
      valueWatchers.set(key, handlers)
      void call("watch", key)
    }
    handlers.add(handler)

    return () => {
      const current = valueWatchers.get(key)
      if (!current) return
      current.delete(handler)
      if (current.size === 0) {
        valueWatchers.delete(key)
        void call("unwatch", key)
      }
    }
  },

  fetch: (input: RequestInfo | URL, init?: RequestInit) => relayFetch(input, init, "text"),

  /** For responses that are bytes — images, audio. See `responseType` in the protocol. */
  fetchBinary: (input: RequestInfo | URL, init?: RequestInit) => relayFetch(input, init, "base64"),
}
