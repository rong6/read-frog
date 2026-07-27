/**
 * Userscript side of the dashboard bridge.
 *
 * Installed only when the current page is the dashboard. Answers the storage
 * and network requests the dashboard's own JavaScript cannot make itself.
 */

import type { BridgeFetchRequest, BridgeFetchResult, BridgeRequest } from "./protocol"
import {
  gmDeleteValue,
  gmGetValue,
  gmListValues,
  gmOnValueChange,
  gmOpenInTab,
  gmSetValue,
  pageWindow,
} from "../gm/api"
import { gmFetch } from "../gm/fetch"
import { BRIDGE_CHANNEL, isBridgeMessage } from "./protocol"

const watchers = new Map<string, () => void>()

/** Abort controllers for in-flight relayed fetches, keyed by the client's request id. */
const inFlight = new Map<number, AbortController>()

function post(message: unknown) {
  // Target the page's real window: under a sandboxing manager `window` is the
  // manager's proxy, and the dashboard's listener lives on the page window.
  pageWindow.postMessage(message, location.origin)
}

function respond(id: number, ok: boolean, value?: unknown, error?: string) {
  post({ channel: BRIDGE_CHANNEL, kind: "response", id, ok, value, error })
}

function encodeBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

async function relayFetch(request: BridgeFetchRequest, id: number): Promise<BridgeFetchResult> {
  const binary = request.responseType === "base64"
  const controller = new AbortController()
  inFlight.set(id, controller)

  try {
    const response = await gmFetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      credentials: request.credentials,
      redirect: request.redirect,
      signal: controller.signal,
      ...(binary ? { gmResponseType: "arraybuffer" as const } : {}),
    })

    const headers: [string, string][] = []
    response.headers.forEach((value, key) => headers.push([key, value]))

    return {
      status: response.status,
      statusText: response.statusText,
      headers,
      body: binary ? encodeBase64(await response.arrayBuffer()) : await response.text(),
      bodyEncoding: binary ? "base64" : "text",
    }
  } finally {
    inFlight.delete(id)
  }
}

async function handle(request: BridgeRequest): Promise<unknown> {
  const [a, b] = request.args as [any, any]

  switch (request.method) {
    case "handshake":
      return { version: 2 }

    case "getValue":
      return await gmGetValue(a, b)

    case "setValue":
      await gmSetValue(a, b)
      return true

    case "deleteValue":
      await gmDeleteValue(a)
      return true

    case "listValues":
      return await gmListValues()

    case "watch": {
      const key = String(a)
      if (watchers.has(key)) return true
      const dispose = gmOnValueChange(key, (newValue, oldValue, remote) => {
        post({
          channel: BRIDGE_CHANNEL,
          kind: "event",
          name: "valueChange",
          payload: { key, newValue, oldValue, remote },
        })
      })
      watchers.set(key, dispose)
      return true
    }

    case "unwatch": {
      const key = String(a)
      watchers.get(key)?.()
      watchers.delete(key)
      return true
    }

    case "fetch":
      return await relayFetch(a as BridgeFetchRequest, request.id)

    case "abortFetch": {
      inFlight.get(Number(a))?.abort()
      return true
    }

    case "openInTab":
      gmOpenInTab(String(a), b !== false)
      return true

    default:
      throw new Error(`Unknown bridge method: ${String(request.method)}`)
  }
}

let installed = false

export function installBridgeHost(): void {
  if (installed) return
  installed = true

  window.addEventListener("message", (event) => {
    // Under Tampermonkey with a @grant list we run sandboxed: `window` is the
    // manager's proxy while `event.source` for a same-window postMessage is the
    // real page window. A strict `!== window` check would drop every request.
    // The origin and channel checks below carry the security weight.
    if (event.source !== window && event.source !== pageWindow) return
    if (event.origin !== location.origin) return
    if (!isBridgeMessage(event.data) || event.data.kind !== "request") return

    const request = event.data
    handle(request).then(
      (value) => respond(request.id, true, value),
      (error: unknown) =>
        respond(request.id, false, undefined, String((error as Error)?.message ?? error)),
    )
  })

  // The dashboard may finish loading before or after us; announce on both edges.
  const announce = () => post({ channel: BRIDGE_CHANNEL, kind: "event", name: "ready" })
  announce()
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", announce, { once: true })
  }
  window.addEventListener("load", announce, { once: true })
}
