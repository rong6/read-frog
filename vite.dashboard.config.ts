/**
 * Dashboard build — the extension's options SPA as a hostable static site.
 *
 * Same source, same routes, same components as `options.html` in the extension.
 * Three aliases make it work off-origin:
 *
 *   `#imports`               -> the shims (as in the userscript build)
 *   `shim/kv`  -> `kv-bridge` -> storage reads/writes hop to the userscript
 *   `utils/runtime-fetch`     -> privileged requests relay through the userscript
 *
 * Unlike the userscript this is a normal multi-chunk app: it is served over
 * HTTP, so code-splitting the twelve lazily-loaded settings pages is a win
 * rather than an impossibility.
 */

import { fileURLToPath } from "node:url"
import path from "node:path"
import react from "@vitejs/plugin-react"
import ViteYaml from "@modyfi/vite-plugin-yaml"
import { defineConfig } from "vite"

const rootDir = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.resolve(rootDir, "src")
const dashboardDir = path.resolve(srcDir, "userscript/dashboard")

export default defineConfig({
  root: dashboardDir,
  // Relative asset URLs so the bundle works from a subpath (GitHub Pages
  // project sites) or straight off the filesystem.
  base: "./",
  publicDir: false,
  // `root` is the dashboard folder, but the .env lives at the repo root and is
  // where WXT_GOOGLE_CLIENT_ID / WXT_API_URL come from.
  envDir: rootDir,

  resolve: {
    alias: [
      { find: /^#imports$/, replacement: path.resolve(srcDir, "userscript/shim/imports.ts") },
      {
        find: /^@webext-core\/messaging$/,
        replacement: path.resolve(srcDir, "userscript/shim/messaging.ts"),
      },
      {
        find: /^posthog-js\/dist\/module\.no-external$/,
        replacement: path.resolve(srcDir, "userscript/stubs/posthog.ts"),
      },
      // These two must be regexes on the *import specifier*: Rollup's alias
      // plugin matches what was written in the source, not a resolved path.
      // They also have to precede the "@" entry, which would otherwise swallow
      // them. (This is why every importer of the kv backend spells it
      // "@/userscript/shim/kv" rather than a relative path.)
      //
      // Storage goes over the page bridge instead of straight to GM.
      {
        find: /^@\/userscript\/shim\/kv$/,
        replacement: path.resolve(srcDir, "userscript/shim/kv-bridge.ts"),
      },
      // …and so do privileged network calls.
      {
        find: /^@\/utils\/runtime-fetch$/,
        replacement: path.resolve(srcDir, "userscript/dashboard/runtime-fetch.ts"),
      },
      // Provider logos are plain remote images and this is our own page, so the
      // content-script asset proxy (built to defeat a *foreign* page's CSP) is
      // both unnecessary and a five-step chain that fails silently. Bypass it.
      {
        find: /^@\/utils\/content-script\/background-asset-url$/,
        replacement: path.resolve(srcDir, "userscript/dashboard/background-asset-url.ts"),
      },
      { find: "@", replacement: srcDir },
    ],
    dedupe: [
      "react",
      "react-dom",
      "@codemirror/state",
      "@codemirror/view",
      "@codemirror/language",
      "@codemirror/lint",
      "@codemirror/autocomplete",
      "@codemirror/search",
      "@codemirror/commands",
      "@lezer/common",
    ],
  },

  define: {
    // Many CJS dependencies (React, jotai/nanostores, better-auth) read
    // `process.env.NODE_ENV` at module scope with no `typeof` guard. A browser
    // has no `process`, so without these the bundle throws
    // `ReferenceError: process is not defined` the moment it loads. Defining
    // them also lets esbuild dead-code-eliminate every dev-only branch.
    "process.env.NODE_ENV": JSON.stringify("production"),
    "process.env": JSON.stringify({ NODE_ENV: "production" }),
    process: JSON.stringify({ env: { NODE_ENV: "production" } }),
    "import.meta.env.BROWSER": JSON.stringify("chrome"),
    "import.meta.env.MANIFEST_VERSION": "3",
    "import.meta.env.WXT_SKIP_ENV_VALIDATION": JSON.stringify("true"),
    __RF_DASHBOARD_URL__: JSON.stringify(""),
    // The dashboard resolves its own address from `location`, which is always
    // right for the page you are currently looking at.
    __RF_RESOLVE_DASHBOARD_FROM_LOCATION__: "true",
  },

  envPrefix: ["VITE_", "WXT_"],

  plugins: [react(), ViteYaml()],

  build: {
    target: "es2022",
    outDir: path.resolve(rootDir, "dist/dashboard"),
    emptyOutDir: true,
    sourcemap: false,
    reportCompressedSize: false,
    rollupOptions: {
      input: {
        index: path.resolve(dashboardDir, "index.html"),
        oauth2callback: path.resolve(dashboardDir, "oauth2callback.html"),
      },
    },
  },
})
