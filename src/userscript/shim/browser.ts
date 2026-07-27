/**
 * `browser` namespace shim.
 *
 * Everything the codebase touches is here. Three tiers:
 *
 *  1. **Real behaviour** — a genuine userscript equivalent exists:
 *     `runtime.getURL`, `runtime.connect/onConnect`, `tabs.create`, `alarms`,
 *     `contextMenus`, `identity`, `i18n`, `storage.session.onChanged`.
 *
 *  2. **Degraded but honest** — the concept exists but is narrower:
 *     `tabs.query` only ever returns this tab; `webNavigation` events fire off
 *     page lifecycle rather than the browser's navigation pipeline.
 *
 *  3. **Inert** — no analogue at all: `action` (toolbar icon), `scripting`
 *     (the userscript is already in every frame), `cookies` (the manager gives
 *     us no cookie observer), `runtime.setUninstallURL`.
 *
 * Tier 3 members are deliberately *present and no-op* rather than deleted, so
 * the modules that use them (`browser-action-icon.ts`, `iframe-injection.ts`,
 * `uninstall-survey.ts`, …) still import and initialise cleanly. That is what
 * keeps this a port rather than a rewrite.
 */

import { USERSCRIPT_VERSION, gmOpenInTab } from "../gm/api"
import { alarmsShim } from "../runtime/alarms"
import { contextMenusShim } from "../runtime/context-menu"
import { resolveExtensionPath } from "../runtime/dashboard-url"
import { identityShim } from "../runtime/identity"
import { EventShim } from "./events"
import { connect, onConnect } from "./ports"
import {
  anyStorageOnChanged,
  localStorageOnChanged,
  sessionStorageOnChanged,
  syncStorageOnChanged,
} from "./session-events"

const EXTENSION_ID = "read-frog-userscript"

function currentTab() {
  return {
    id: 0,
    index: 0,
    windowId: 0,
    url: location.href,
    title: document.title,
    active: !document.hidden,
    highlighted: !document.hidden,
    pinned: false,
    incognito: false,
    status: document.readyState === "complete" ? "complete" : "loading",
  }
}

/* ------------------------------------------------------------------ */
/* runtime                                                             */
/* ------------------------------------------------------------------ */

const onInstalled = new EventShim<[{ reason: string; previousVersion?: string }]>(
  "runtime.onInstalled",
)
const onMessageEvent = new EventShim<[unknown, unknown, (response: unknown) => void]>(
  "runtime.onMessage",
)
const onSuspend = new EventShim<[]>("runtime.onSuspend")

const runtime = {
  id: EXTENSION_ID,
  lastError: undefined as { message: string } | undefined,

  getManifest: () => ({
    manifest_version: 3,
    name: "Read Frog",
    version: USERSCRIPT_VERSION,
    description: "Read Frog — userscript build",
  }),

  /**
   * Extension-relative URLs become dashboard URLs. Bundled assets are inlined as
   * data URIs at build time, so `new URL(dataUri, getURL("/"))` still resolves
   * correctly with `location.origin` as the base.
   */
  getURL: (path: string) => {
    // Callers use `getURL("/")` purely as a base for `new URL(asset, base)`.
    // The document's own directory is the right base: in the userscript build
    // assets are data URIs so it does not matter, but the dashboard emits real
    // asset files and may be hosted under a subpath (GitHub Pages project
    // sites), where resolving against the origin root would 404.
    if (!path || path === "/") {
      try {
        return new URL("./", document.baseURI).href
      } catch {
        return `${location.origin}/`
      }
    }
    const normalized = path.startsWith("/") ? path : `/${path}`
    if (normalized.startsWith("/options.html") || normalized.startsWith("/translation-hub.html")) {
      return resolveExtensionPath(normalized)
    }
    try {
      return new URL(normalized, `${location.origin}/`).href
    } catch {
      return normalized
    }
  },

  openOptionsPage: async () => {
    gmOpenInTab(resolveExtensionPath("/options.html"), true)
  },

  connect,
  onConnect,
  onInstalled,
  onMessage: onMessageEvent,
  onSuspend,

  /** No userscript analogue; the manager owns uninstall UX. */
  setUninstallURL: async (_url?: string) => {},

  sendMessage: async (_message: unknown) => undefined,

  getContexts: async () => [],
}

/* ------------------------------------------------------------------ */
/* tabs                                                                */
/* ------------------------------------------------------------------ */

const tabsOnRemoved = new EventShim<[number, { windowId: number; isWindowClosing: boolean }]>(
  "tabs.onRemoved",
)
const tabsOnActivated = new EventShim<[{ tabId: number; windowId: number }]>("tabs.onActivated")
const tabsOnUpdated = new EventShim<[number, Record<string, unknown>, unknown]>("tabs.onUpdated")

const tabs = {
  create: async (options: { url?: string; active?: boolean }) => {
    if (options.url) gmOpenInTab(options.url, options.active ?? true)
    return currentTab()
  },

  /**
   * There is exactly one tab from a userscript's point of view. Callers use this
   * either to find "the active tab" (this one) or to broadcast to every matching
   * tab (which degrades to this one).
   */
  query: async (queryInfo: { url?: string | string[] } = {}) => {
    const patterns = queryInfo.url
      ? Array.isArray(queryInfo.url)
        ? queryInfo.url
        : [queryInfo.url]
      : undefined

    if (patterns && !patterns.some((pattern) => matchesUrlPattern(pattern, location.href))) {
      return []
    }
    return [currentTab()]
  },

  get: async (_tabId: number) => currentTab(),
  reload: async () => {
    location.reload()
  },
  sendMessage: async () => undefined,

  onRemoved: tabsOnRemoved,
  onActivated: tabsOnActivated,
  onUpdated: tabsOnUpdated,
}

/** Very small `*://host/path` matcher — enough for the official-site queries. */
function matchesUrlPattern(pattern: string, url: string): boolean {
  try {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, "[^]*")
      .replace(/\?/g, "\\?")
    return new RegExp(`^${escaped}$`).test(url)
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ */
/* the rest                                                            */
/* ------------------------------------------------------------------ */

const webNavigation = {
  onCommitted: new EventShim<[{ tabId: number; frameId: number; url: string }]>(
    "webNavigation.onCommitted",
  ),
  onCompleted: new EventShim<[{ tabId: number; frameId: number; url: string }]>(
    "webNavigation.onCompleted",
  ),
  onBeforeNavigate: new EventShim<[{ tabId: number; frameId: number; url: string }]>(
    "webNavigation.onBeforeNavigate",
  ),
  /** The userscript is injected into every frame directly, so there is nothing to enumerate. */
  getAllFrames: async () => [] as { frameId: number; url: string; parentFrameId: number }[],
}

const action = {
  setIcon: async () => {},
  setBadgeText: async () => {},
  setTitle: async () => {},
  getUserSettings: async () => ({ isOnToolbar: true }),
  onUserSettingsChanged: new EventShim<[{ isOnToolbar: boolean }]>(
    "action.onUserSettingsChanged",
  ),
  onClicked: new EventShim<[unknown]>("action.onClicked"),
}

const cookies = {
  /**
   * Userscript managers expose no cookie observer, so this never fires. Both
   * consumers degrade rather than break: `proxy-fetch.ts` falls back to TTL
   * expiry for its auth cache, and `notebase-pending-save.ts` still runs its
   * queue on startup — it just will not react the instant the user logs in.
   */
  onChanged: new EventShim<[{ cookie: any; removed: boolean }]>("cookies.onChanged"),
  getAll: async () => [] as { name: string; value: string; domain: string }[],
  get: async () => null,
}

const scripting = {
  /** No-op: the userscript already runs in every frame, so there is nothing to inject. */
  executeScript: async () => [] as { result?: unknown }[],
  insertCSS: async () => {},
  removeCSS: async () => {},
}

const i18nShim = {
  getUILanguage: () => navigator.language || "en",
  getMessage: (key: string) => (key === "@@ui_locale" ? navigator.language || "en" : ""),
  getAcceptLanguages: async () => [...(navigator.languages ?? [navigator.language])],
}

const storageNamespace = {
  local: { onChanged: localStorageOnChanged },
  session: { onChanged: sessionStorageOnChanged, setAccessLevel: async () => {} },
  sync: { onChanged: syncStorageOnChanged },
  // Area-agnostic listeners receive `(changes, areaName)`, as they do on the
  // real API — branching on the area must not silently pick "local".
  onChanged: anyStorageOnChanged,
}

const sidePanel = undefined
const sidebarAction = undefined

export const browser = {
  runtime,
  tabs,
  alarms: alarmsShim,
  contextMenus: contextMenusShim,
  menus: contextMenusShim,
  identity: identityShim,
  webNavigation,
  action,
  browserAction: action,
  cookies,
  scripting,
  i18n: i18nShim,
  storage: storageNamespace,
  sidePanel,
  sidebarAction,
}

export type Browser = typeof browser

/** Re-exported so `runtime/*` modules can push page lifecycle into the events. */
export const browserEvents = {
  tabsOnRemoved,
  tabsOnActivated,
  tabsOnUpdated,
  onInstalled,
  webNavigation,
}
