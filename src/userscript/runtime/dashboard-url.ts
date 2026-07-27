/**
 * Where the compiled dashboard (the old `options.html` SPA) lives.
 *
 * The extension resolved `browser.runtime.getURL("/options.html#/route")`
 * against its own origin. A userscript has no origin of its own, so the
 * dashboard is a separate static build the user hosts (GitHub Pages, Cloudflare
 * Pages, an intranet path — anything). The address is stored in GM storage so it
 * can be changed from the script-manager menu without rebuilding or
 * reinstalling.
 *
 * It deliberately defaults to *unset* rather than to some plausible URL: an
 * address baked in at build time that nobody owns is a dead link at best, and a
 * domain someone else could register at worst. Unset is an honest state that the
 * menu can prompt about.
 */

import { kv } from "@/userscript/shim/kv"

/** Build-time default, from `RF_DASHBOARD_URL`. Empty means "ask the user". */
declare const __RF_DASHBOARD_URL__: string
/** True only in the dashboard build, where "the dashboard" is this very page. */
declare const __RF_RESOLVE_DASHBOARD_FROM_LOCATION__: boolean

const STORAGE_KEY = "rf:userscript:dashboardBaseUrl"

/** Where this page itself lives — the right answer when the dashboard is asking. */
function locationBase(): string {
  return `${location.origin}${location.pathname.replace(/\/[^/]*$/, "/")}`
}

function buildTimeDefault(): string {
  if (
    typeof __RF_RESOLVE_DASHBOARD_FROM_LOCATION__ !== "undefined" &&
    __RF_RESOLVE_DASHBOARD_FROM_LOCATION__
  ) {
    return locationBase()
  }
  return typeof __RF_DASHBOARD_URL__ === "string" ? __RF_DASHBOARD_URL__ : ""
}

export const DEFAULT_DASHBOARD_URL: string = buildTimeDefault()

let cached: string | undefined

export async function loadDashboardBaseUrl(): Promise<string> {
  let stored: string | undefined
  try {
    stored = await kv.get<string>(STORAGE_KEY)
  } catch {
    // No value store (a manager without GM_getValue) — the compiled-in default
    // is still correct, so this is not worth failing the boot over.
    stored = undefined
  }
  cached = typeof stored === "string" && stored.length > 0 ? stored : DEFAULT_DASHBOARD_URL
  return cached
}

export async function setDashboardBaseUrl(url: string): Promise<void> {
  cached = normalizeBaseUrl(url)
  await kv.set(STORAGE_KEY, cached)
}

/** Synchronous read; `loadDashboardBaseUrl()` must have run during bootstrap. */
export function getDashboardBaseUrl(): string {
  return cached ?? DEFAULT_DASHBOARD_URL
}

/** False until the user (or the build) has pointed the script at a dashboard. */
export function isDashboardConfigured(): boolean {
  return getDashboardBaseUrl().trim().length > 0
}

/**
 * Accepts what a person would actually type — `example.com/rf`,
 * `https://example.com/rf/index.html`, trailing slash or not — and returns a
 * directory-style base URL. Throws on input that is not a URL at all, so the
 * caller can say so instead of silently storing junk.
 */
export function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ""

  const withScheme = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  const url = new URL(withScheme)

  url.hash = ""
  url.search = ""
  // Point at the directory: `/rf/index.html` and `/rf/` are the same dashboard.
  url.pathname = url.pathname.replace(/\/[^/]*\.html?$/i, "/")
  if (!url.pathname.endsWith("/")) url.pathname += "/"

  return url.href
}

/**
 * Translate an extension-relative path into a dashboard URL.
 *
 * `/options.html#/api-providers` -> `<base>#/api-providers`
 * `/translation-hub.html`        -> `<base>#/translation-hub`
 *
 * Returns "" when no dashboard is configured; callers prompt rather than
 * navigate somewhere meaningless.
 */
export function resolveExtensionPath(path: string): string {
  const base = getDashboardBaseUrl().replace(/\/+$/, "")
  if (!base) return ""

  const [file, hash = ""] = path.replace(/^\//, "").split("#")

  if (file === "options.html" || file === "") {
    return hash ? `${base}/#${hash}` : `${base}/`
  }
  if (file === "translation-hub.html") {
    return `${base}/#/translation-hub`
  }
  // Anything else (offscreen.html, sandbox pages…) has no userscript analogue.
  return `${base}/${file}${hash ? `#${hash}` : ""}`
}

/** True when the current page *is* the dashboard, so we bridge instead of translating it. */
export function isDashboardPage(href: string = location.href): boolean {
  const base = getDashboardBaseUrl()
  if (!base) return false
  try {
    const baseUrl = new URL(base)
    const current = new URL(href)
    if (baseUrl.origin !== current.origin) return false
    const basePath = baseUrl.pathname.replace(/\/+$/, "")
    const currentPath = current.pathname.replace(/\/+$/, "")
    return currentPath === basePath || currentPath === `${basePath}/index.html`
  } catch {
    return false
  }
}
