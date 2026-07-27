/**
 * `browser.identity` replacement for the Google Drive sync OAuth flow.
 *
 * The extension used `identity.launchWebAuthFlow`, which owns a private popup
 * and hands back the final redirect URL. A userscript has neither an extension
 * origin nor that API, so:
 *
 *   1. `getRedirectURL()` points at `oauth2callback.html`, a one-page file
 *      emitted by the dashboard build.
 *   2. `launchWebAuthFlow()` opens the provider's consent screen in a popup.
 *   3. The userscript also runs on the callback page (it is under the dashboard
 *      origin, which the script `@match`es). There it copies `location.hash`
 *      into GM storage and closes itself.
 *   4. Back on the original page we poll GM storage for that value and resolve
 *      with a synthetic redirect URL — the exact shape `google-drive/auth.ts`
 *      already knows how to parse, so that file needs no changes.
 *
 * Because `appDataFolder` is partitioned per OAuth client, the userscript build
 * must use its own `WXT_GOOGLE_CLIENT_ID`; it will not see files written by the
 * official extension. WebDAV sync exists precisely to avoid that limitation.
 */

import { kv } from "@/userscript/shim/kv"
import { getDashboardBaseUrl } from "./dashboard-url"

const RESULT_KEY = "rf:oauth:result"
const POLL_INTERVAL_MS = 400
const DEFAULT_TIMEOUT_MS = 5 * 60_000

export function getRedirectURL(path = ""): string {
  const base = getDashboardBaseUrl().replace(/\/+$/, "")
  return `${base}/oauth2callback.html${path}`
}

export function isOAuthCallbackPage(href: string = location.href): boolean {
  try {
    return new URL(href).pathname.endsWith("/oauth2callback.html")
  } catch {
    return false
  }
}

/**
 * Runs on the callback page: hand the fragment back to whichever tab is waiting.
 */
export async function publishOAuthCallbackResult(): Promise<void> {
  const fragment = location.hash.startsWith("#") ? location.hash.slice(1) : location.hash
  const query = location.search.startsWith("?") ? location.search.slice(1) : location.search
  await kv.set(RESULT_KEY, {
    fragment,
    query,
    href: location.href,
    at: Date.now(),
  })

  document.title = "Read Frog — authorized"
  const message = document.createElement("div")
  message.style.cssText =
    "font:16px/1.6 system-ui,sans-serif;padding:48px;text-align:center;color:#111"
  message.textContent = "Authorization complete. You can close this window."
  document.body?.replaceChildren(message)

  setTimeout(() => {
    try {
      window.close()
    } catch {
      /* the browser may refuse to close a non-script-opened window */
    }
  }, 800)
}

export interface LaunchWebAuthFlowDetails {
  url: string
  interactive?: boolean
}

export async function launchWebAuthFlow(details: LaunchWebAuthFlowDetails): Promise<string> {
  await kv.delete(RESULT_KEY)

  const popup = window.open(
    details.url,
    "read-frog-oauth",
    "width=520,height=680,menubar=no,toolbar=no",
  )
  if (!popup) {
    throw new Error(
      "Could not open the authorization window. Allow pop-ups for this site and try again.",
    )
  }

  const deadline = Date.now() + DEFAULT_TIMEOUT_MS

  while (Date.now() < deadline) {
    // getFresh, not get: on the dashboard `kv` memoises, so a plain read would
    // return the same cached `undefined` for the whole loop and only ever
    // complete by accident via the change event.
    const result = await kv.getFresh<{ fragment?: string; query?: string; href?: string }>(
      RESULT_KEY,
    )
    if (result?.href) {
      await kv.delete(RESULT_KEY)
      try {
        popup.close()
      } catch {
        /* ignore */
      }
      return result.href
    }

    if (popup.closed) {
      // Give the callback page a moment to finish writing before giving up.
      await sleep(POLL_INTERVAL_MS * 3)
      const late = await kv.getFresh<{ href?: string }>(RESULT_KEY)
      if (late?.href) {
        await kv.delete(RESULT_KEY)
        return late.href
      }
      throw new Error("Authorization window was closed before completing.")
    }

    await sleep(POLL_INTERVAL_MS)
  }

  try {
    popup.close()
  } catch {
    /* ignore */
  }
  throw new Error("Authorization timed out.")
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

export const identityShim = { getRedirectURL, launchWebAuthFlow }
