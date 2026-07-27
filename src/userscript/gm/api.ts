/**
 * Normalized access to the Greasemonkey/Tampermonkey/Violentmonkey API surface.
 *
 * Managers disagree on which spelling they expose:
 *  - Tampermonkey  : `GM_*` (sync) *and* `GM.*` (promise), depending on @grant
 *  - Violentmonkey : `GM_*` and `GM.*`
 *  - Greasemonkey 4: `GM.*` only
 *
 * IMPORTANT: the `GM_*` bindings are injected by the manager as *closure scope*
 * variables around the script body, not as properties of `globalThis`. They must
 * therefore be referenced by bare identifier (guarded with `typeof`), never via
 * `globalThis.GM_x` and never via indirect `eval`, both of which resolve in
 * global scope and would miss them.
 */

/* eslint-disable ts/no-unsafe-function-type */

declare const GM: any
declare const GM_getValue: any
declare const GM_setValue: any
declare const GM_deleteValue: any
declare const GM_listValues: any
declare const GM_addValueChangeListener: any
declare const GM_removeValueChangeListener: any
declare const GM_xmlhttpRequest: any
declare const GM_addStyle: any
declare const GM_registerMenuCommand: any
declare const GM_unregisterMenuCommand: any
declare const GM_openInTab: any
declare const GM_info: any
declare const GM_setClipboard: any
declare const unsafeWindow: any

const gmNamespace: Record<string, any> = typeof GM !== "undefined" && GM ? GM : {}

/** Prefer the legacy sync binding, fall back to the promise-based `GM.*` one. */
export const gm = {
  info: typeof GM_info !== "undefined"
    ? GM_info
    : (gmNamespace.info ?? { script: { version: "0.0.0", name: "Read Frog" }, scriptHandler: "unknown" }),

  getValue: typeof GM_getValue !== "undefined" ? GM_getValue : gmNamespace.getValue,
  setValue: typeof GM_setValue !== "undefined" ? GM_setValue : gmNamespace.setValue,
  deleteValue: typeof GM_deleteValue !== "undefined" ? GM_deleteValue : gmNamespace.deleteValue,
  listValues: typeof GM_listValues !== "undefined" ? GM_listValues : gmNamespace.listValues,
  addValueChangeListener:
    typeof GM_addValueChangeListener !== "undefined"
      ? GM_addValueChangeListener
      : gmNamespace.addValueChangeListener,
  removeValueChangeListener:
    typeof GM_removeValueChangeListener !== "undefined"
      ? GM_removeValueChangeListener
      : gmNamespace.removeValueChangeListener,

  xmlHttpRequest:
    typeof GM_xmlhttpRequest !== "undefined" ? GM_xmlhttpRequest : gmNamespace.xmlHttpRequest,
  addStyle: typeof GM_addStyle !== "undefined" ? GM_addStyle : gmNamespace.addStyle,
  registerMenuCommand:
    typeof GM_registerMenuCommand !== "undefined"
      ? GM_registerMenuCommand
      : gmNamespace.registerMenuCommand,
  unregisterMenuCommand:
    typeof GM_unregisterMenuCommand !== "undefined"
      ? GM_unregisterMenuCommand
      : gmNamespace.unregisterMenuCommand,
  openInTab: typeof GM_openInTab !== "undefined" ? GM_openInTab : gmNamespace.openInTab,
  setClipboard: typeof GM_setClipboard !== "undefined" ? GM_setClipboard : gmNamespace.setClipboard,
}

/**
 * The page's real `window` when the manager sandboxes us, otherwise the global.
 *
 * `globalThis`, not a bare `window`: this module is reached from
 * `@/utils/runtime-fetch`, which the MV3 background imports — and a service
 * worker has no `window`, so a bare reference here is a `ReferenceError` at
 * import time that takes the whole background down. Same story under Vitest's
 * default `node` environment.
 */
export const pageWindow: Window & typeof globalThis =
  typeof unsafeWindow !== "undefined" && unsafeWindow
    ? unsafeWindow
    : (globalThis as Window & typeof globalThis)

export const USERSCRIPT_VERSION: string = gm.info?.script?.version ?? "0.0.0"

/** e.g. "Tampermonkey" / "Violentmonkey" — used for capability warnings. */
export const USERSCRIPT_MANAGER: string = gm.info?.scriptHandler ?? "unknown"

function requireApi<T>(value: T | undefined, grant: string): T {
  if (!value) {
    throw new Error(
      `[read-frog] Missing userscript grant: ${grant}. ` +
        `Reinstall the script so the manager picks up its @grant list.`,
    )
  }
  return value
}

export async function gmGetValue<T>(key: string, fallback?: T): Promise<T | undefined> {
  const fn = requireApi(gm.getValue, "GM_getValue")
  return await Promise.resolve(fn(key, fallback))
}

export async function gmSetValue(key: string, value: unknown): Promise<void> {
  const fn = requireApi(gm.setValue, "GM_setValue")
  await Promise.resolve(fn(key, value))
}

export async function gmDeleteValue(key: string): Promise<void> {
  const fn = requireApi(gm.deleteValue, "GM_deleteValue")
  await Promise.resolve(fn(key))
}

export async function gmListValues(): Promise<string[]> {
  if (!gm.listValues) return []
  return (await Promise.resolve(gm.listValues())) ?? []
}

/**
 * Cross-tab value change notification. Returns a disposer.
 * Falls back to a no-op when the manager lacks the API (Greasemonkey 4);
 * `storage.watch` then only sees same-tab writes, which is degraded but usable.
 */
export function gmOnValueChange(
  key: string,
  handler: (newValue: unknown, oldValue: unknown, remote: boolean) => void,
): () => void {
  if (!gm.addValueChangeListener) return () => {}
  let handle: unknown
  try {
    handle = gm.addValueChangeListener(
      key,
      (_name: string, oldValue: unknown, newValue: unknown, remote: boolean) => {
        handler(newValue, oldValue, remote)
      },
    )
  } catch {
    return () => {}
  }
  return () => {
    try {
      gm.removeValueChangeListener?.(handle)
    } catch {
      /* ignore */
    }
  }
}

export function gmAddStyle(css: string): HTMLStyleElement | undefined {
  if (gm.addStyle) {
    try {
      return gm.addStyle(css)
    } catch {
      /* fall through to manual injection */
    }
  }
  const style = document.createElement("style")
  style.textContent = css
  ;(document.head ?? document.documentElement).appendChild(style)
  return style
}

export function gmRegisterMenuCommand(
  label: string,
  handler: () => void,
): number | string | undefined {
  try {
    return gm.registerMenuCommand?.(label, handler)
  } catch {
    return undefined
  }
}

export function gmUnregisterMenuCommand(id: number | string | undefined): void {
  if (id === undefined) return
  try {
    gm.unregisterMenuCommand?.(id)
  } catch {
    /* ignore */
  }
}

export function gmOpenInTab(url: string, active = true): void {
  if (gm.openInTab) {
    try {
      gm.openInTab(url, { active, insert: true, setParent: true })
      return
    } catch {
      /* fall through */
    }
  }
  window.open(url, "_blank", "noopener")
}

export function hasGmXhr(): boolean {
  return typeof gm.xmlHttpRequest === "function"
}
