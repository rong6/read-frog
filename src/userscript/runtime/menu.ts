/**
 * Script-manager menu commands.
 *
 * The extension put these in its toolbar popup and the right-click menu. A
 * userscript has neither, so the manager's own command list is the entry point:
 * toggle translation, open the dashboard, and point the script at wherever the
 * dashboard is hosted.
 *
 * The items `browser.contextMenus` registers are handled separately in
 * `runtime/context-menu.ts`, which maps onto this same command list — so the
 * user sees one menu, not two.
 */

import { i18n } from "@/utils/i18n"
import { logger } from "@/utils/logger"
import { sendMessage } from "@/utils/message"
import { gmOpenInTab, gmRegisterMenuCommand } from "../gm/api"
import {
  getDashboardBaseUrl,
  isDashboardConfigured,
  normalizeBaseUrl,
  resolveExtensionPath,
  setDashboardBaseUrl,
} from "./dashboard-url"

let registered = false

/**
 * i18n keys resolved defensively. `initI18n` runs before this in `main.ts`, but
 * a missing locale entry should degrade to readable English rather than render
 * the raw key into the user's menu.
 */
function translate(key: string, fallback: string): string {
  try {
    const value = i18n.t(key as never)
    return value && value !== key ? value : fallback
  } catch {
    return fallback
  }
}

const PROMPT_TEXT =
  "Read Frog — dashboard address\n\n" +
  "Paste the URL where you deployed the dashboard build (the dist/dashboard folder).\n" +
  "Example: https://yourname.github.io/read-frog-userscript/\n\n" +
  "Leave blank to clear it."

/**
 * Ask for the dashboard address and store it.
 *
 * Returns the stored URL, or "" if the user cancelled or cleared it — so a
 * caller that needed the dashboard can give up quietly instead of opening a
 * blank tab.
 */
async function promptForDashboardUrl(): Promise<string> {
  const current = getDashboardBaseUrl()

  for (;;) {
    const answer = window.prompt(PROMPT_TEXT, current)
    if (answer === null) return ""

    if (!answer.trim()) {
      await setDashboardBaseUrl("")
      return ""
    }

    let normalized: string
    try {
      normalized = normalizeBaseUrl(answer)
    } catch {
      window.alert(`That does not look like a URL:\n\n${answer}\n\nTry again.`)
      continue
    }

    await setDashboardBaseUrl(normalized)
    return normalized
  }
}

/** Open a dashboard route, prompting for the address first if it is not set yet. */
async function openDashboard(path: `/${string}`): Promise<void> {
  if (!isDashboardConfigured()) {
    const url = await promptForDashboardUrl()
    if (!url) return
  }

  const target = resolveExtensionPath(path)
  if (target) gmOpenInTab(target, true)
}

function togglePageTranslation(enabled: boolean) {
  void sendMessage("tryToSetEnablePageTranslationOnContentScript", { enabled }).catch(
    (error: unknown) => {
      // Fires when the page has no host content script — a site the user has
      // disabled, or the dashboard itself. Not worth a dialog.
      logger.warn("[Userscript] could not toggle page translation", error)
    },
  )
}

export function registerMenuCommands(): void {
  if (registered) return
  registered = true

  gmRegisterMenuCommand(translate("popup.translate", "Translate"), () => {
    togglePageTranslation(true)
  })

  gmRegisterMenuCommand(translate("popup.showOriginal", "Show Original"), () => {
    togglePageTranslation(false)
  })

  gmRegisterMenuCommand(translate("popup.options", "Options"), () => {
    void openDashboard("/options.html")
  })

  gmRegisterMenuCommand(translate("translationHub.title", "Translation Hub"), () => {
    void openDashboard("/translation-hub.html")
  })

  gmRegisterMenuCommand("Set dashboard URL…", () => {
    void promptForDashboardUrl().then((url) => {
      if (!url) return
      if (window.confirm(`Dashboard set to:\n${url}\n\nOpen it now?`)) {
        gmOpenInTab(url, true)
      }
    })
  })
}
