/**
 * The module the userscript/dashboard builds alias `#imports` to.
 *
 * WXT's real `#imports` is generated into `.wxt/` by `wxt prepare` (which still
 * runs on postinstall, so TypeScript keeps type-checking every call site against
 * the genuine WXT types). At *bundle* time Vite swaps in this file instead, so
 * the same source compiles for both the extension and the userscript.
 *
 * Everything exported here is a drop-in for the WXT symbol of the same name.
 */

export { browser, type Browser } from "./browser"
export {
  type BackgroundDefinition,
  type ContentScriptContext,
  type ContentScriptDefinition,
  contentScriptMatches,
  createContentScriptContext,
  defineBackground,
  defineContentScript,
  defineUnlistedScript,
} from "./content-script"
export {
  createIntegratedUi,
  createShadowRootUi,
  type ShadowRootUi,
  type ShadowRootUiOptions,
} from "./shadow-root-ui"
export { storage, type StorageItemKey } from "./storage"

/** WXT exposes these for content-script authors; nothing in this app uses them. */
export function injectScript(): Promise<void> {
  return Promise.resolve()
}

export const fakeBrowser = undefined
