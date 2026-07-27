/**
 * Wire protocol between the userscript and the dashboard page.
 *
 * The dashboard is an ordinary static site: its own JavaScript has no access to
 * `GM_getValue`, so it cannot read the settings the userscript stores, and its
 * `fetch` is bound by the dashboard origin's CORS rules. The userscript also
 * runs on that page (it is inside the `@match` list) and acts as a broker.
 *
 * `window.postMessage` is used rather than assigning functions onto
 * `unsafeWindow`, because sandbox function-export semantics differ between
 * Tampermonkey, Violentmonkey and Greasemonkey, whereas structured-clone
 * messaging behaves identically everywhere. Every operation is already async,
 * so nothing is lost.
 *
 * The one thing structured clone costs us is that a `Response` cannot cross the
 * channel, so `fetch` results are flattened — and, because a JSON string cannot
 * carry arbitrary bytes, binary responses are base64-encoded rather than
 * decoded as text. Getting that wrong silently corrupts every image and every
 * TTS audio buffer, which is why `responseType` is part of the request rather
 * than something the host guesses.
 */

export const BRIDGE_CHANNEL = "read-frog-userscript-bridge"

export type BridgeMethod =
  | "handshake"
  | "getValue"
  | "setValue"
  | "deleteValue"
  | "listValues"
  | "watch"
  | "unwatch"
  | "fetch"
  | "abortFetch"
  | "openInTab"

export interface BridgeRequest {
  channel: typeof BRIDGE_CHANNEL
  kind: "request"
  id: number
  method: BridgeMethod
  args: unknown[]
}

export interface BridgeResponse {
  channel: typeof BRIDGE_CHANNEL
  kind: "response"
  id: number
  ok: boolean
  value?: unknown
  error?: string
}

export interface BridgeEvent {
  channel: typeof BRIDGE_CHANNEL
  kind: "event"
  name: "valueChange" | "ready"
  payload?: unknown
}

export type BridgeMessage = BridgeRequest | BridgeResponse | BridgeEvent

export function isBridgeMessage(data: unknown): data is BridgeMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { channel?: unknown }).channel === BRIDGE_CHANNEL
  )
}

/** A `Request` flattened into something structured clone can carry. */
export interface BridgeFetchRequest {
  url: string
  method: string
  headers: [string, string][]
  body?: string
  credentials?: RequestCredentials
  redirect?: RequestRedirect
  /**
   * `"base64"` round-trips the response through an ArrayBuffer. Required for
   * anything that is not text: `responseText` is a UTF-8 *decode*, so binary
   * bytes come back as U+FFFD and re-encoding yields a different payload.
   */
  responseType?: "text" | "base64"
}

/** Serialisable form of a `Response`, since one cannot cross `postMessage`. */
export interface BridgeFetchResult {
  status: number
  statusText: string
  headers: [string, string][]
  body: string
  bodyEncoding: "text" | "base64"
}

/**
 * Per-method ceilings. A key-value round trip is a local function call and
 * should never take seconds, so a short timeout there catches a genuinely
 * missing userscript. A relayed `fetch` is a network request to an LLM
 * provider, which legitimately runs for minutes — applying the same ceiling
 * would abort real work and, worse, report it as "the userscript did not
 * respond", blaming the user's installation for a slow model.
 */
export const BRIDGE_TIMEOUT_MS: Record<BridgeMethod, number> = {
  handshake: 4_000,
  getValue: 15_000,
  setValue: 15_000,
  deleteValue: 15_000,
  listValues: 15_000,
  watch: 15_000,
  unwatch: 15_000,
  openInTab: 15_000,
  abortFetch: 15_000,
  // No ceiling: the caller's AbortSignal is relayed, so cancellation is its job.
  fetch: Number.POSITIVE_INFINITY,
}
