/**
 * Shown when the dashboard loads but no Read Frog userscript answers the bridge.
 *
 * Two things cause this and the copy needs to distinguish them, because the fix
 * is different: the script is not installed at all, or it *is* installed but
 * points at a different dashboard URL and so does not `@match` this page.
 *
 * Deliberately dependency-free — React and the config atoms are downstream of a
 * working bridge, so this must render without either.
 */

const STYLE = `
:root { color-scheme: light dark }
.rf-notice-root {
  min-height: 100vh; margin: 0; display: grid; place-items: center;
  font: 15px/1.65 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  background: Canvas; color: CanvasText; padding: 24px;
}
.rf-notice { max-width: 34rem }
.rf-notice h1 { font-size: 1.35rem; margin: 0 0 .75rem; font-weight: 650 }
.rf-notice p { margin: 0 0 .85rem; opacity: .85 }
.rf-notice ol { margin: 0 0 .85rem; padding-left: 1.3rem }
.rf-notice li { margin-bottom: .35rem }
.rf-notice code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .875em;
  background: color-mix(in srgb, CanvasText 8%, transparent);
  padding: .12em .4em; border-radius: .3em;
}
.rf-notice .rf-url { word-break: break-all }
`

export function renderMissingScriptNotice(): void {
  const style = document.createElement("style")
  style.textContent = STYLE
  document.head.appendChild(style)

  document.body.className = "rf-notice-root"

  const notice = document.createElement("div")
  notice.className = "rf-notice"

  const heading = document.createElement("h1")
  heading.textContent = "Read Frog userscript not detected"

  const intro = document.createElement("p")
  intro.textContent =
    "This page is the settings dashboard. It reads and writes the userscript's stored settings, " +
    "so it needs the script running alongside it."

  const steps = document.createElement("ol")
  for (const text of [
    "Install a userscript manager (Tampermonkey or Violentmonkey).",
    "Install read-frog.user.js.",
    "Reload this page.",
  ]) {
    const item = document.createElement("li")
    item.textContent = text
    steps.append(item)
  }

  const alreadyInstalled = document.createElement("p")
  alreadyInstalled.append(document.createTextNode("Already installed? Then the script is pointed at a different dashboard address and is not running here. Open the script manager's menu on any page, choose "))
  const menuItem = document.createElement("code")
  menuItem.textContent = "Set dashboard URL…"
  alreadyInstalled.append(menuItem, document.createTextNode(", and enter:"))

  const url = document.createElement("p")
  url.className = "rf-url"
  const urlCode = document.createElement("code")
  urlCode.textContent = `${location.origin}${location.pathname.replace(/\/index\.html$/, "/")}`
  url.append(urlCode)

  notice.append(heading, intro, steps, alreadyInstalled, url)
  document.body.replaceChildren(notice)
}
