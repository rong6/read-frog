/**
 * `createShadowRootUi` shim.
 *
 * Reproduces WXT's DOM shape exactly, because the app depends on the details:
 *
 *   <read-frog>                       <- shadowHost, custom element
 *     #shadow-root (open)
 *       <html>
 *         <head><style/></head>
 *         <body>                      <- `uiContainer` handed to onMount
 *
 * `src/utils/shadow-root.ts` restores overlay geometry with rules targeting
 * `:host` and `body`, and `src/utils/styles.ts` recognises WXT's document-level
 * style element by its `wxt-shadow-root-document-styles` attribute — both only
 * work against this structure, so it is copied rather than reinvented.
 *
 * The Tailwind bundle WXT would have injected via `cssInjectionMode: "ui"` comes
 * from `./ui-css`.
 */

import type { ContentScriptContext } from "./content-script"
import { uiCssForEntry } from "./ui-css"

const PROPERTY_AND_FONT_FACE_RULES_PATTERN =
  /(@(?:property|font-face)[^{}]*\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})/g

/** WXT's isolation reset, prepended inside every shadow root it creates. */
const WXT_HOST_RESET = `:host{all:initial!important}`

const DOCUMENT_STYLE_ATTRIBUTE = "wxt-shadow-root-document-styles"

/**
 * `@property` and `@font-face` do not register from inside a shadow root, so
 * they are hoisted into the page. Tailwind 4 relies on `@property` for every
 * animated custom property, which is why this matters.
 */
function splitDocumentCss(css: string): { documentCss: string; shadowCss: string } {
  let shadowCss = css
  let documentCss = ""
  for (const match of css.matchAll(PROPERTY_AND_FONT_FACE_RULES_PATTERN)) {
    documentCss += `${match[1]}\n`
    shadowCss = shadowCss.replace(match[1], "")
  }
  return { documentCss: documentCss.trim(), shadowCss: shadowCss.trim() }
}

let documentStyleElement: HTMLStyleElement | null = null
const injectedDocumentCss = new Set<string>()

function injectDocumentCss(css: string) {
  if (!css || injectedDocumentCss.has(css)) return
  injectedDocumentCss.add(css)

  if (!documentStyleElement) {
    documentStyleElement = document.createElement("style")
    documentStyleElement.setAttribute(DOCUMENT_STYLE_ATTRIBUTE, "")
    ;(document.head ?? document.documentElement).appendChild(documentStyleElement)
  }
  documentStyleElement.textContent = `${documentStyleElement.textContent ?? ""}\n${css}`
}

export interface ShadowRootUiOptions<TMounted> {
  name: string
  position?: "inline" | "overlay" | "modal"
  anchor?: string | HTMLElement | (() => HTMLElement | null | undefined)
  append?: "last" | "first" | "replace" | "after" | "before"
  css?: string
  zIndex?: number
  isolateEvents?: boolean | string[]
  mode?: "open" | "closed"
  onMount: (uiContainer: HTMLElement, shadow: ShadowRoot, shadowHost: HTMLElement) => TMounted
  onRemove?: (mounted: TMounted | undefined) => void
}

export interface ShadowRootUi<TMounted> {
  shadow: ShadowRoot
  shadowHost: HTMLElement
  uiContainer: HTMLElement
  mounted: TMounted | undefined
  mount: () => void
  remove: () => void
}

function resolveAnchor(anchor: ShadowRootUiOptions<unknown>["anchor"]): HTMLElement {
  if (typeof anchor === "function") return (anchor() as HTMLElement) ?? document.body
  if (anchor instanceof HTMLElement) return anchor
  if (typeof anchor === "string") {
    return (document.querySelector(anchor) as HTMLElement | null) ?? document.body
  }
  return document.body
}

function applyPositionStyles(host: HTMLElement, position: ShadowRootUiOptions<unknown>["position"]) {
  if (position === "inline") return
  if (position === "modal") {
    host.style.cssText = "top:0;bottom:0;left:0;right:0;position:fixed;"
    return
  }
  // overlay
  host.style.cssText = "overflow:visible;position:relative;width:0;height:0;display:block;"
}

export async function createShadowRootUi<TMounted>(
  ctx: ContentScriptContext,
  options: ShadowRootUiOptions<TMounted>,
): Promise<ShadowRootUi<TMounted>> {
  const shadowHost = document.createElement(options.name)
  applyPositionStyles(shadowHost, options.position ?? "inline")
  if (options.zIndex !== undefined) shadowHost.style.zIndex = String(options.zIndex)

  const shadow = shadowHost.attachShadow({ mode: options.mode ?? "open" })

  // WXT builds a full document skeleton inside the shadow root.
  const html = document.createElement("html")
  const head = document.createElement("head")
  const body = document.createElement("body")

  // Only the *entry* CSS gets the `:root` -> `:host` rewrite (done in ui-css.ts),
  // matching WXT. `options.css` is authored against `:host` on purpose — see
  // OVERLAY_SHADOW_ROOT_CSS in src/utils/shadow-root.ts — so rewriting it too
  // would be wrong.
  const combined = [WXT_HOST_RESET, uiCssForEntry(options.name), options.css ?? ""]
    .filter(Boolean)
    .join("\n")
  const { documentCss, shadowCss } = splitDocumentCss(combined)
  injectDocumentCss(documentCss)

  const style = document.createElement("style")
  style.textContent = shadowCss
  head.appendChild(style)

  html.appendChild(head)
  html.appendChild(body)
  shadow.appendChild(html)

  if (options.isolateEvents) {
    const events =
      typeof options.isolateEvents === "boolean"
        ? ["keydown", "keyup", "keypress"]
        : options.isolateEvents
    for (const eventName of events) {
      shadowHost.addEventListener(eventName, (event) => event.stopPropagation())
    }
  }

  let mounted: TMounted | undefined
  let isMounted = false

  const ui: ShadowRootUi<TMounted> = {
    shadow,
    shadowHost,
    uiContainer: body,
    get mounted() {
      return mounted
    },
    mount() {
      if (isMounted) return
      const anchor = resolveAnchor(options.anchor)
      switch (options.append) {
        case "first":
          anchor.prepend(shadowHost)
          break
        case "replace":
          anchor.replaceChildren(shadowHost)
          break
        case "before":
          anchor.parentElement?.insertBefore(shadowHost, anchor)
          break
        case "after":
          anchor.parentElement?.insertBefore(shadowHost, anchor.nextSibling)
          break
        default:
          anchor.append(shadowHost)
      }
      mounted = options.onMount(body, shadow, shadowHost)
      isMounted = true
    },
    remove() {
      if (!isMounted) return
      isMounted = false
      options.onRemove?.(mounted)
      mounted = undefined
      body.replaceChildren()
      shadowHost.remove()
    },
  }

  ctx.onInvalidated(() => ui.remove())

  return ui
}

/** WXT also exports these; provided so imports resolve even though we do not use them. */
export function createIntegratedUi<TMounted>(
  ctx: ContentScriptContext,
  options: {
    position?: "inline" | "overlay" | "modal"
    anchor?: ShadowRootUiOptions<unknown>["anchor"]
    append?: ShadowRootUiOptions<unknown>["append"]
    onMount: (container: HTMLElement) => TMounted
    onRemove?: (mounted: TMounted | undefined) => void
  },
) {
  const wrapper = document.createElement("div")
  let mounted: TMounted | undefined
  const ui = {
    wrapper,
    get mounted() {
      return mounted
    },
    mount() {
      resolveAnchor(options.anchor).append(wrapper)
      mounted = options.onMount(wrapper)
    },
    remove() {
      options.onRemove?.(mounted)
      mounted = undefined
      wrapper.replaceChildren()
      wrapper.remove()
    },
  }
  ctx.onInvalidated(() => ui.remove())
  return ui
}
