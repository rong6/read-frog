/**
 * `defineContentScript` / `defineBackground` / `ContentScriptContext` shims.
 *
 * WXT wraps each entrypoint in a definition object that its build turns into a
 * separate bundle with its own manifest registration. The userscript build has
 * exactly one bundle, so a definition is just a record we execute ourselves —
 * `src/userscript/main.ts` reads `matches` and decides whether to run `main()`
 * on the current page, which reproduces the manifest's matching behaviour.
 */

import { MatchPattern } from "@webext-core/match-patterns"

export interface ContentScriptContext {
  readonly isValid: boolean
  readonly isInvalid: boolean
  readonly signal: AbortSignal
  onInvalidated: (callback: () => void) => void
  abort: (reason?: string) => void
  addEventListener: (
    target: EventTarget,
    type: string,
    handler: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions | boolean,
  ) => void
  setTimeout: (handler: () => void, timeout?: number) => number
  setInterval: (handler: () => void, timeout?: number) => number
  requestAnimationFrame: (callback: FrameRequestCallback) => number
  block: () => Promise<never>
}

export interface ContentScriptDefinition {
  matches?: string[]
  excludeMatches?: string[]
  runAt?: "document_start" | "document_end" | "document_idle"
  allFrames?: boolean
  world?: "MAIN" | "ISOLATED"
  cssInjectionMode?: "manifest" | "ui" | "manual"
  registration?: "manifest" | "runtime"
  main: (ctx: ContentScriptContext) => void | Promise<void>
}

export interface BackgroundDefinition {
  type?: "module"
  persistent?: boolean
  main: () => void | Promise<void>
}

export function defineContentScript(definition: ContentScriptDefinition): ContentScriptDefinition {
  return definition
}

export function defineBackground(
  definition: BackgroundDefinition | (() => void),
): BackgroundDefinition {
  return typeof definition === "function" ? { main: definition } : definition
}

export function defineUnlistedScript<T>(definition: T): T {
  return definition
}

/**
 * In the extension a context is invalidated when the extension reloads and the
 * content script is orphaned. A userscript is never orphaned that way, so the
 * only invalidation trigger is the page going away — which is exactly when the
 * cleanup callbacks (unmounting React roots, clearing injection guards) should
 * run anyway.
 */
export function createContentScriptContext(): ContentScriptContext {
  const controller = new AbortController()
  const timers = new Set<number>()
  const intervals = new Set<number>()

  const invalidate = () => {
    if (controller.signal.aborted) return
    for (const id of timers) clearTimeout(id)
    for (const id of intervals) clearInterval(id)
    timers.clear()
    intervals.clear()
    controller.abort("page-unload")
  }

  window.addEventListener("pagehide", invalidate, { once: true })

  const ctx: ContentScriptContext = {
    get isValid() {
      return !controller.signal.aborted
    },
    get isInvalid() {
      return controller.signal.aborted
    },
    get signal() {
      return controller.signal
    },
    onInvalidated(callback) {
      if (controller.signal.aborted) {
        callback()
        return
      }
      controller.signal.addEventListener("abort", () => callback(), { once: true })
    },
    abort(reason) {
      if (!controller.signal.aborted) controller.abort(reason)
    },
    // WXT's signature is (target, type, handler, options) — target first — and
    // it ties the listener to the context's lifetime.
    addEventListener(target, type, handler, options) {
      const merged =
        typeof options === "object" && options !== null
          ? { ...options, signal: controller.signal }
          : { capture: options as boolean | undefined, signal: controller.signal }
      target.addEventListener(type, handler, merged)
    },
    setTimeout(handler, timeout) {
      const id = window.setTimeout(() => {
        timers.delete(id)
        if (!controller.signal.aborted) handler()
      }, timeout)
      timers.add(id)
      return id
    },
    setInterval(handler, timeout) {
      const id = window.setInterval(() => {
        if (!controller.signal.aborted) handler()
      }, timeout)
      intervals.add(id)
      return id
    },
    requestAnimationFrame(callback) {
      return window.requestAnimationFrame((time) => {
        if (!controller.signal.aborted) callback(time)
      })
    },
    block() {
      return new Promise<never>(() => {})
    },
  }

  return ctx
}

/** Reproduces the manifest's `matches` / `exclude_matches` filtering. */
export function contentScriptMatches(
  definition: ContentScriptDefinition,
  url: string = location.href,
): boolean {
  const matches = definition.matches ?? ["*://*/*"]
  const excluded = definition.excludeMatches ?? []

  const test = (pattern: string) => {
    try {
      return new MatchPattern(pattern).includes(url)
    } catch {
      return false
    }
  }

  if (excluded.some(test)) return false
  return matches.some(test)
}
