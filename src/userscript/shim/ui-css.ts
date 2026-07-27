/**
 * The stylesheet WXT would have injected into a shadow-root UI via
 * `cssInjectionMode: "ui"`.
 *
 * Two details that are easy to get wrong, and were:
 *
 * 1. **Per entrypoint, not global.** WXT collected whatever CSS *that*
 *    entrypoint imported. `side.content` imports `theme.css` + `text-small.css`;
 *    `selection.content` imports only `theme.css`. Handing every shadow root the
 *    union would shrink the selection toolbar's type scale (text-small.css drops
 *    the base font from 16px to 14px), which is exactly the kind of silent UI
 *    drift this port is supposed to avoid.
 *
 * 2. **`:root` does not match inside a shadow tree.** WXT rewrites the entry CSS
 *    with `.replaceAll(":root", ":host")` before injecting it, and this repo does
 *    the same in its two hand-rolled shadow hosts
 *    (`react-shadow-host/shadow-host-builder.ts`, `host/translate/ui/style-injector.ts`).
 *    Without it, `theme.css`'s light-mode `:root { --rf-* }` block never applies
 *    and every design token — `bg-popover`, `border-border`, `shadow-floating`,
 *    `rounded-*` — resolves to nothing. Tailwind v4's own variables survive
 *    because it emits them under `:root, :host`, which is why the damage looks
 *    partial and only in light mode.
 *
 * `?inline` returns the PostCSS/Tailwind output as a string rather than emitting
 * an asset, which is what lets the whole bundle stay one file.
 */

import { kebabCase } from "case-anything"
import textSmallCss from "@/assets/styles/text-small.css?inline"
import themeCss from "@/assets/styles/theme.css?inline"
import { APP_NAME } from "@/utils/constants/app"

function forShadowRoot(css: string): string {
  return css.replaceAll(":root", ":host")
}

const THEME = forShadowRoot(themeCss)
const TEXT_SMALL = forShadowRoot(textSmallCss)

/**
 * Keyed by the `name` passed to `createShadowRootUi`, which is WXT's entrypoint
 * identity. Built from the same `APP_NAME` the entrypoints derive theirs from,
 * so renaming the app cannot silently orphan an entry.
 */
const ENTRY_STYLESHEETS: Record<string, string> = {
  // src/entrypoints/side.content/index.tsx
  [kebabCase(APP_NAME)]: [THEME, TEXT_SMALL].join("\n"),
  // src/entrypoints/selection.content/index.tsx
  [`${kebabCase(APP_NAME)}-selection`]: THEME,
}

/** Falls back to the theme alone — the one stylesheet every UI needs. */
export function uiCssForEntry(name: string): string {
  const css = ENTRY_STYLESHEETS[name]
  if (css !== undefined) return css

  console.warn(
    `[read-frog] no stylesheet mapping for shadow-root UI "${name}"; ` +
      `falling back to theme.css. Add it to ENTRY_STYLESHEETS in shim/ui-css.ts.`,
  )
  return THEME
}
