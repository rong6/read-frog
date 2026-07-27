/**
 * Dashboard-build replacement for `@/utils/runtime-fetch`.
 *
 * `vite.dashboard.config.ts` aliases the shared module here. The dashboard is a
 * plain static page, so privileged requests (provider `/models` probes, Google
 * Drive, WebDAV) have to be relayed through the userscript over the bridge —
 * otherwise they would be blocked by CORS.
 *
 * When no userscript is present we fall back to the platform `fetch` so the
 * dashboard still renders and can show its "install the script" prompt rather
 * than exploding at import time.
 */

import { bridge, isBridgeReady } from "../bridge/client"

const relayed: typeof fetch = async (input, init) => {
  if (isBridgeReady()) return await bridge.fetch(input as RequestInfo, init)
  return await fetch(input as RequestInfo, init)
}

export const runtimeFetch: typeof fetch = relayed
export const providerFetch: typeof fetch | undefined = relayed
/**
 * The bridge relays bodies as text, so this is not byte-safe. Nothing the
 * dashboard does needs raw bytes today (the settings pages fetch JSON), and a
 * binary channel is not worth building until something does.
 */
export const runtimeFetchBinary: typeof fetch = relayed
export const IS_USERSCRIPT_RUNTIME = true
