/**
 * Forces every imported asset into the JavaScript bundle as a data URI.
 *
 * The app imports its logos with `?url&no-inline`, which in the extension build
 * is exactly right: WXT emits real files and serves them from the extension
 * origin via `web_accessible_resources`. A userscript has no origin and no file
 * server — a separate `.png` next to the script would simply 404 — so for that
 * build the `no-inline` hint has to be dropped and the bytes carried inline.
 *
 * Implemented as an id rewrite rather than a `load` hook so Vite's own asset
 * pipeline still does the encoding.
 */

const ASSET_QUERY = /[?&]url&no-inline\b/

export function inlineAssetsPlugin() {
  return {
    name: "read-frog:inline-assets",
    enforce: "pre",

    async resolveId(source, importer, options) {
      if (!ASSET_QUERY.test(source)) return null

      // Drop `&no-inline`, keep `?url`; with `assetsInlineLimit: Infinity`
      // Vite then returns a data URI string instead of an emitted file.
      const rewritten = source.replace(/&no-inline\b/, "")
      const resolved = await this.resolve(rewritten, importer, { ...options, skipSelf: true })
      return resolved ?? null
    },
  }
}
