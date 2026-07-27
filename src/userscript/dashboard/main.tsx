/**
 * Dashboard entry point.
 *
 * The dashboard is the extension's options SPA, rebuilt as a static site. Every
 * page, route, component and config atom is reused verbatim — the only thing
 * this file adds is the handshake with the userscript, because the settings it
 * edits live in the script's GM storage rather than in this page's own.
 *
 * Route mapping matches what `runtime/dashboard-url.ts` produces:
 *   <base>/#/...                -> the options SPA (its own HashRouter)
 *   <base>/#/translation-hub    -> the standalone translation hub
 */

import { waitForBridge } from "../bridge/client"
import { startBackground } from "../runtime/background"
import { renderMissingScriptNotice } from "./missing-script-notice"

const TRANSLATION_HUB_HASH = "#/translation-hub"

async function boot() {
  try {
    // The userscript announces itself as soon as it runs; without it there is
    // no storage to read and every panel would render empty.
    await waitForBridge()
  } catch {
    renderMissingScriptNotice()
    return
  }

  // The dashboard needs its own copy of the background handlers.
  //
  // In the extension, the options page and the service worker were two contexts
  // of one extension, so `sendMessage` from a settings panel reached the
  // background. Here the dashboard is an ordinary web page on a different
  // origin from the userscript — nothing it sends can reach the copy of the
  // background running in some other tab. Without this, every settings feature
  // that talks to the background fails with "Receiving end does not exist":
  // the text-to-speech preview, provider logo fetching, the model-suggestion
  // probe, Notebase, and the whole translation hub.
  //
  // Running it here is cheap and correct: it is the same code, and its storage
  // and network calls are already routed over the bridge to the userscript, so
  // it operates on the same settings the pages do.
  //
  // The one exception is the database cleanup. Unlike storage and network,
  // IndexedDB does *not* hop over the bridge — it is this origin's, and it is
  // empty — while the alarm claim that guards the job is shared with every tab
  // running the script. So the dashboard would win the claim, prune nothing,
  // and leave the caches that matter alone until the period came round again.
  // We know statically that we are the dashboard, so we say so rather than
  // re-deriving it from the URL.
  await startBackground({ skipDatabaseCleanup: true })

  if (location.hash.startsWith(TRANSLATION_HUB_HASH)) {
    await import("@/entrypoints/translation-hub/main")
    return
  }

  await import("@/entrypoints/options/main")
}

// Switching between the hub and the settings pages swaps which app owns #root,
// so a full reload is the honest way to do it.
let lastWasHub = location.hash.startsWith(TRANSLATION_HUB_HASH)
window.addEventListener("hashchange", () => {
  const isHub = location.hash.startsWith(TRANSLATION_HUB_HASH)
  if (isHub !== lastWasHub) {
    lastWasHub = isHub
    location.reload()
  }
})

void boot()
