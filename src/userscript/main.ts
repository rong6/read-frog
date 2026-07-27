/**
 * Userscript entry point.
 *
 * The extension had eight independently-registered entrypoints (one background
 * service worker, seven content scripts) that the browser started for us
 * according to the manifest. A userscript is a single script, so this file does
 * the manifest's job: it decides which of those entrypoints apply to the current
 * page and runs them, in the right order, at the right time.
 *
 * Every `defineContentScript` definition is imported unchanged from
 * `src/entrypoints/`; only the scheduling around them lives here.
 */

import "@/utils/zod-config"

import type { ContentScriptDefinition } from "./shim/content-script"
import { contentScriptMatches, createContentScriptContext } from "./shim/content-script"
import { installBridgeHost } from "./bridge/host"
import { USERSCRIPT_MANAGER, USERSCRIPT_VERSION, hasGmXhr } from "./gm/api"
import { isDashboardPage, loadDashboardBaseUrl } from "./runtime/dashboard-url"
import { isOAuthCallbackPage, publishOAuthCallbackResult } from "./runtime/identity"
import { getLocalConfig } from "@/utils/config/storage"
import { initI18n } from "@/utils/i18n"
import { registerMenuCommands } from "./runtime/menu"
import { startBackground } from "./runtime/background"

/* Entrypoints, imported exactly as WXT would have bundled them. */
import guideContent from "@/entrypoints/guide.content/index"
import hostContent from "@/entrypoints/host.content/index"
import inputInjectorContent from "@/entrypoints/input-injector.content/index"
import interceptorContent from "@/entrypoints/interceptor.content/index"
import selectionContent from "@/entrypoints/selection.content/index"
import sideContent from "@/entrypoints/side.content/index"
import subtitlesContent from "@/entrypoints/subtitles.content/index"

const IS_TOP_FRAME = (() => {
  try {
    return window.top === window.self
  } catch {
    return false
  }
})()

interface ScheduledScript {
  name: string
  definition: ContentScriptDefinition
  /** WXT/manifest `all_frames`. Scripts without it only ran in the top frame. */
  allFrames?: boolean
}

/**
 * `document_start` scripts. These two patch page globals (the YouTube player
 * API, input-element setters) and must be in place before the page's own code
 * runs, which is why the whole userscript is `@run-at document-start`.
 */
const EARLY_SCRIPTS: ScheduledScript[] = [
  { name: "interceptor", definition: interceptorContent, allFrames: true },
  { name: "input-injector", definition: inputInjectorContent, allFrames: true },
]

/** Everything else, started once the DOM exists. */
const LATE_SCRIPTS: ScheduledScript[] = [
  { name: "host", definition: hostContent, allFrames: true },
  // The manifest default (top frame only). Mounting the whole selection
  // toolbar — shadow root, React root, query client — into every ad iframe on
  // every page is not what the extension did and not worth the cost.
  { name: "selection", definition: selectionContent, allFrames: false },
  { name: "side", definition: sideContent, allFrames: false },
  { name: "subtitles", definition: subtitlesContent, allFrames: true },
  { name: "guide", definition: guideContent, allFrames: false },
]

function run(script: ScheduledScript): void | Promise<void> {
  if (!script.allFrames && !IS_TOP_FRAME) return
  if (!contentScriptMatches(script.definition)) return

  try {
    // Deliberately not awaited by `runEarly` — see below.
    return Promise.resolve(script.definition.main(createContentScriptContext())).catch(
      (error: unknown) => {
        console.error(`[read-frog] entrypoint "${script.name}" failed to start`, error)
      },
    )
  } catch (error) {
    console.error(`[read-frog] entrypoint "${script.name}" failed to start`, error)
  }
}

/**
 * Starts the `document_start` scripts.
 *
 * Called before `bootstrap` awaits anything, and itself synchronous up to each
 * entrypoint's first await. That ordering is the whole point: both of these
 * patch page globals — `interceptor` wraps `XMLHttpRequest.prototype` to observe
 * YouTube's `timedtext` requests, `input-injector` installs its message listener
 * — and a single `await` first (a GM storage read is a real IPC hop on
 * Violentmonkey) is long enough for the page to have fired the requests we came
 * to intercept.
 *
 * Neither needs the config or the dashboard URL, so neither has to wait.
 */
function runEarlyScripts(): void {
  for (const script of EARLY_SCRIPTS) void run(script)
}

function whenDomReady(): Promise<void> {
  if (document.readyState !== "loading") return Promise.resolve()
  return new Promise((resolve) => {
    document.addEventListener("DOMContentLoaded", () => resolve(), { once: true })
  })
}

async function bootstrap() {
  if (!hasGmXhr()) {
    console.error(
      "[read-frog] GM_xmlhttpRequest is unavailable. The script cannot reach translation " +
        "providers without it — reinstall so the manager picks up the @grant list.",
    )
    return
  }

  // Before the first await. See runEarlyScripts().
  runEarlyScripts()

  await loadDashboardBaseUrl()

  // The OAuth landing page only needs to hand its fragment back and close.
  if (isOAuthCallbackPage()) {
    await publishOAuthCallbackResult()
    return
  }

  // On the dashboard we are a storage/network broker, not a translator.
  if (isDashboardPage()) {
    installBridgeHost()
    return
  }

  // The "background" is just more code in this page. Every frame gets its own
  // copy because messaging is frame-local; the pieces that must not run N times
  // (alarms, the manager menu) guard on the top frame themselves.
  await startBackground()

  if (IS_TOP_FRAME) {
    // The menu labels come from i18n, and the content scripts that would
    // normally call initI18n have not run yet (and may bail out entirely on a
    // site the user disabled). Initialise it here so the manager's menu is not
    // stuck with English fallbacks. initI18n is idempotent.
    try {
      const config = await getLocalConfig()
      await initI18n(config?.uiLanguage)
    } catch (error) {
      console.warn("[read-frog] i18n init failed; menu labels fall back to English", error)
    }
    registerMenuCommands()
  }

  await whenDomReady()
  await Promise.all(LATE_SCRIPTS.map((script) => run(script)))
}

console.info(`[read-frog] userscript ${USERSCRIPT_VERSION} on ${USERSCRIPT_MANAGER}`)

void bootstrap().catch((error) => {
  console.error("[read-frog] bootstrap failed", error)
})
