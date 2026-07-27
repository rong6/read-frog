/**
 * `fetch`-compatible wrapper over `GM_xmlhttpRequest`.
 *
 * This is the single most important shim in the userscript port: it is what
 * lets the AI SDK, better-auth, oRPC and the translation-service clients run
 * unchanged from a page context. Page `fetch` would be subject to the host
 * page's CORS policy and CSP; `GM_xmlhttpRequest` is not.
 *
 * It returns a real `Response` (streaming where the manager supports it), so
 * callers that do `res.json()`, `res.text()`, `res.body!.getReader()` or SSE
 * parsing all keep working.
 */

import type { ProxyRequest, ProxyResponse } from "@/types/proxy-fetch"
import { gm, hasGmXhr } from "./api"

export interface GmFetchInit extends RequestInit {
  /**
   * Force a binary round-trip. Needed for audio/image payloads, where reading
   * `responseText` would mangle bytes. Disables incremental streaming.
   */
  gmResponseType?: "arraybuffer"
  /** Per-request timeout in ms. */
  gmTimeout?: number
}

/**
 * GM_xmlhttpRequest's `timeout` is a *total* request timeout, not an idle one.
 * Applying it to a streamed completion would abort long translations mid-flight,
 * which platform `fetch` (used by the extension build) never does — so streamed
 * requests get no ceiling and rely on the caller's AbortSignal instead.
 */
const DEFAULT_BUFFERED_TIMEOUT_MS = 120_000

function parseResponseHeaders(raw: string | undefined | null): Headers {
  const headers = new Headers()
  if (!raw) return headers
  for (const line of raw.trim().split(/[\r\n]+/)) {
    const index = line.indexOf(":")
    if (index <= 0) continue
    const name = line.slice(0, index).trim()
    const value = line.slice(index + 1).trim()
    if (!name) continue
    try {
      headers.append(name, value)
    } catch {
      /* forbidden header name — ignore */
    }
  }
  return headers
}

function normalizeHeaders(init?: HeadersInit): Record<string, string> {
  const out: Record<string, string> = {}
  if (!init) return out
  new Headers(init).forEach((value, key) => {
    out[key] = value
  })
  return out
}

async function normalizeBody(body: BodyInit | null | undefined): Promise<
  string | ArrayBuffer | Blob | FormData | URLSearchParams | undefined
> {
  if (body === null || body === undefined) return undefined
  if (typeof body === "string") return body
  if (body instanceof URLSearchParams) return body.toString()
  if (body instanceof FormData || body instanceof Blob) return body
  if (body instanceof ArrayBuffer) return body
  if (ArrayBuffer.isView(body)) {
    return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer
  }
  if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) {
    // GM_xmlhttpRequest cannot upload a stream — buffer it.
    return await new Response(body).text()
  }
  return String(body)
}

function resolveRequest(input: RequestInfo | URL, init?: GmFetchInit) {
  if (typeof Request !== "undefined" && input instanceof Request) {
    return {
      url: input.url,
      method: (init?.method ?? input.method ?? "GET").toUpperCase(),
      headers: { ...normalizeHeaders(input.headers), ...normalizeHeaders(init?.headers) },
      credentials: init?.credentials ?? input.credentials,
      bodySource: (init?.body ?? undefined) as BodyInit | null | undefined,
      requestForBody: input,
    }
  }
  return {
    url: input instanceof URL ? input.href : String(input),
    method: (init?.method ?? "GET").toUpperCase(),
    headers: normalizeHeaders(init?.headers),
    credentials: init?.credentials,
    bodySource: init?.body,
    requestForBody: undefined as Request | undefined,
  }
}

/**
 * Drop-in replacement for `fetch` backed by `GM_xmlhttpRequest`.
 *
 * Streaming: while the manager reports progress we push the newly-arrived
 * slice of `responseText` into the Response body, so SSE consumers (AI SDK
 * `streamText`) see tokens as they arrive rather than all at the end.
 */
export async function gmFetch(input: RequestInfo | URL, init?: GmFetchInit): Promise<Response> {
  if (!hasGmXhr()) {
    // No grant (or running in the extension build) — use the platform fetch.
    return await fetch(input as RequestInfo, init)
  }

  const resolved = resolveRequest(input, init)
  let body = await normalizeBody(resolved.bodySource)
  if (body === undefined && resolved.requestForBody && resolved.method !== "GET" && resolved.method !== "HEAD") {
    const text = await resolved.requestForBody.clone().text()
    body = text.length > 0 ? text : undefined
  }

  const signal = init?.signal ?? undefined
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError")
  }

  const binary = init?.gmResponseType === "arraybuffer"

  return await new Promise<Response>((resolve, reject) => {
    let settledHeaders = false
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null
    let deliveredLength = 0
    let closed = false
    let aborted = false
    const encoder = new TextEncoder()

    const stream = binary
      ? null
      : new ReadableStream<Uint8Array>({
          start(controller) {
            controllerRef = controller
          },
          // Without this, a consumer that drops the body (the AI SDK tearing a
          // stream down without going through the AbortSignal) would leave the
          // provider request downloading to completion in the background.
          cancel() {
            aborted = true
            try {
              handle?.abort?.()
            } catch {
              /* already finished */
            }
          },
        })

    const pushText = (fullText: string | undefined) => {
      if (closed || binary || !controllerRef || typeof fullText !== "string") return
      if (fullText.length <= deliveredLength) return
      const slice = fullText.slice(deliveredLength)
      deliveredLength = fullText.length
      try {
        controllerRef.enqueue(encoder.encode(slice))
      } catch {
        /* controller already closed */
      }
    }

    const closeStream = () => {
      if (closed || !controllerRef) return
      closed = true
      try {
        controllerRef.close()
      } catch {
        /* already closed */
      }
    }

    const failStream = (error: unknown) => {
      if (closed || !controllerRef) return
      closed = true
      try {
        controllerRef.error(error)
      } catch {
        /* already closed */
      }
    }

    const emitHeaders = (response: any) => {
      if (settledHeaders || binary) return
      // Managers differ in what they populate on progress events. Resolving
      // before the real status is known would turn a 401/429/500 into a
      // fabricated `200 OK` with no content-type, and the AI SDK would try to
      // SSE-parse an error body instead of raising a usable provider error.
      const status = response?.status ?? 0
      if (!status) return
      settledHeaders = true
      resolve(
        new Response(status === 204 || status === 205 || status === 304 ? null : stream, {
          status,
          statusText: response?.statusText ?? "",
          headers: parseResponseHeaders(response?.responseHeaders),
        }),
      )
    }

    let handle: { abort?: () => void } | undefined

    const onAbort = () => {
      aborted = true
      try {
        handle?.abort?.()
      } catch {
        /* ignore */
      }
      const error = new DOMException("The operation was aborted.", "AbortError")
      if (!settledHeaders) {
        settledHeaders = true
        reject(error)
      } else {
        failStream(error)
      }
    }

    signal?.addEventListener("abort", onAbort, { once: true })

    const finish = () => {
      signal?.removeEventListener("abort", onAbort)
    }

    const details: Record<string, unknown> = {
      method: resolved.method,
      url: resolved.url,
      headers: resolved.headers,
      data: body,
      ...(init?.gmTimeout !== undefined
        ? { timeout: init.gmTimeout }
        : binary
          ? { timeout: DEFAULT_BUFFERED_TIMEOUT_MS }
          : {}),
      // GM_xmlhttpRequest attaches the user's cookies for the *target* origin by
      // default. `fetch` defaults to "same-origin", i.e. no cookies cross-origin —
      // so without this, translating a page would ship the user's provider
      // cookies to every AI endpoint. Only an explicit "include" opts in.
      anonymous: (resolved.credentials ?? "same-origin") !== "include",
      // Deliberately NOT `fetch: true`. That option makes Tampermonkey route the
      // request through the Fetch API, and managers have been seen to reject
      // non-standard verbs (PROPFIND, MKCOL) on that path — which is every
      // WebDAV request. The default XHR path takes any method, and XHR already
      // exposes a growing `responseText` through onprogress, which is all the
      // streaming below needs.
      redirect: init?.redirect === "manual" ? "manual" : "follow",
      onreadystatechange: (response: any) => {
        if (aborted) return
        // readyState 2 = HEADERS_RECEIVED — resolve early so consumers can stream.
        if (response?.readyState === 2 || response?.readyState === 3) {
          emitHeaders(response)
        }
        if (response?.readyState === 3) {
          pushText(response.responseText)
        }
      },
      onprogress: (response: any) => {
        if (aborted) return
        emitHeaders(response)
        pushText(response?.responseText)
      },
      onload: (response: any) => {
        if (aborted) return
        finish()
        if (binary) {
          const buffer: ArrayBuffer =
            response?.response instanceof ArrayBuffer ? response.response : new ArrayBuffer(0)
          resolve(
            new Response(buffer, {
              status: response?.status || 200,
              statusText: response?.statusText ?? "",
              headers: parseResponseHeaders(response?.responseHeaders),
            }),
          )
          return
        }
        emitHeaders(response)
        if (!settledHeaders) {
          // No progress event ever carried a status; settle from the final one.
          settledHeaders = true
          resolve(
            new Response(response?.responseText ?? "", {
              status: response?.status || 200,
              statusText: response?.statusText ?? "",
              headers: parseResponseHeaders(response?.responseHeaders),
            }),
          )
          return
        }
        pushText(response?.responseText)
        closeStream()
      },
      onerror: (response: any) => {
        if (aborted) return
        finish()
        // GM_xmlhttpRequest reports transport failures with almost no context,
        // and the causes are very different from each other: the host missing
        // from @connect, a manager refusing the HTTP verb, DNS/TLS failure, a
        // server that closed the connection. Surface everything the manager
        // gives us so the next person does not have to guess.
        const detail = [
          response?.error && `error=${response.error}`,
          response?.status !== undefined && response.status !== 0 && `status=${response.status}`,
          response?.statusText && `statusText=${response.statusText}`,
          response?.readyState !== undefined && `readyState=${response.readyState}`,
        ]
          .filter(Boolean)
          .join(", ")

        const error = new TypeError(
          `Network request failed: ${resolved.method} ${resolved.url}` +
            (detail ? ` (${detail})` : " (no detail from the userscript manager — " +
              "usually the host is not covered by @connect, or the manager refused the HTTP method)"),
        )
        if (!settledHeaders) {
          settledHeaders = true
          reject(error)
        } else {
          failStream(error)
        }
      },
      ontimeout: () => {
        if (aborted) return
        finish()
        const error = new TypeError(`Network request timed out: ${resolved.method} ${resolved.url}`)
        if (!settledHeaders) {
          settledHeaders = true
          reject(error)
        } else {
          failStream(error)
        }
      },
      onabort: () => {
        finish()
        const error = new DOMException("The operation was aborted.", "AbortError")
        if (!settledHeaders) {
          settledHeaders = true
          reject(error)
        } else {
          failStream(error)
        }
      },
    }

    if (binary) {
      details.responseType = "arraybuffer"
    }

    try {
      handle = gm.xmlHttpRequest(details)
    } catch (error) {
      finish()
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

function encodeArrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

/**
 * Userscript implementation of the extension's `backgroundFetch` message.
 * Mirrors `src/entrypoints/background/proxy-fetch.ts` response shape exactly so
 * every existing caller of `sendMessage("backgroundFetch", ...)` is unaffected.
 */
export async function gmProxyFetch(request: ProxyRequest): Promise<ProxyResponse> {
  const responseType = request.responseType ?? "text"
  const response = await gmFetch(request.url, {
    method: (request.method ?? "GET").toUpperCase(),
    headers: request.headers,
    body: request.body,
    credentials: request.credentials ?? "include",
    redirect: request.redirect,
    ...(responseType === "base64" ? { gmResponseType: "arraybuffer" as const } : {}),
  })

  const headers: [string, string][] = []
  response.headers.forEach((value, key) => headers.push([key, value]))

  return {
    status: response.status,
    statusText: response.statusText,
    headers,
    body:
      responseType === "base64"
        ? encodeArrayBufferToBase64(await response.arrayBuffer())
        : await response.text(),
    bodyEncoding: responseType,
  }
}
