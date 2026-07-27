/**
 * The `fetch` implementation to use for outbound requests that must not be
 * subject to the *page's* CORS policy or CSP.
 *
 * In the extension build these requests already run privileged (in the service
 * worker with `host_permissions: *://*​/*`), so the platform `fetch` is correct.
 * In the userscript build there is no privileged context — everything runs in
 * the page — so they go through `GM_xmlhttpRequest` instead.
 *
 * Deciding this once, here, means every call site stays a plain `fetch(...)`
 * shape and neither build needs its own copy of the networking code.
 */

import { hasGmXhr } from "@/userscript/gm/api"
import { gmFetch } from "@/userscript/gm/fetch"

const useGm = hasGmXhr()

/** Privileged fetch. Identical to `fetch` in the extension build. */
export const runtimeFetch: typeof fetch = useGm
  ? (gmFetch as unknown as typeof fetch)
  : ((input, init) => fetch(input, init)) as typeof fetch

/**
 * Passed to the AI SDK provider factories as their `fetch` option.
 *
 * `undefined` in the extension build so the SDK keeps its own default (which
 * gives it the `Response` semantics it expects); the GM-backed implementation
 * in the userscript build, where it is what lets the provider call escape the
 * host page's CSP. `gmFetch` returns a genuine streaming `Response`, so
 * `streamText` and SSE parsing behave the same either way.
 */
export const providerFetch: typeof fetch | undefined = useGm
  ? (gmFetch as unknown as typeof fetch)
  : undefined

/**
 * Privileged fetch for responses that are *bytes*, not text.
 *
 * `GM_xmlhttpRequest` streams text by exposing `responseText`, which is a UTF-8
 * decode of the payload — run arbitrary binary through it and every invalid
 * sequence becomes U+FFFD, so re-encoding gives back different bytes. Audio and
 * images therefore have to opt into an `arraybuffer` round-trip, which also
 * means giving up incremental streaming (fine: nothing streams a WAV).
 *
 * Identical to `runtimeFetch` in the extension build.
 */
export const runtimeFetchBinary: typeof fetch = useGm
  ? ((input, init) =>
      gmFetch(input as RequestInfo, { ...init, gmResponseType: "arraybuffer" })) as typeof fetch
  : ((input, init) => fetch(input, init)) as typeof fetch

/** True when running as a userscript. Prefer feature checks over this. */
export const IS_USERSCRIPT_RUNTIME = useGm
