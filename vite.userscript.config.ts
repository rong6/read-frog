/**
 * Userscript build.
 *
 * Deliberately *not* WXT. WXT emits one bundle per entrypoint plus HTML pages
 * and a manifest — the opposite of what a userscript needs. Driving Vite
 * directly gives us the single self-contained IIFE the format requires, and
 * costs only the handful of aliases below, since the shims already present the
 * same API surface WXT did.
 *
 * `wxt prepare` still runs on postinstall, so `.wxt/` keeps generating the real
 * `#imports` / `#i18n` types and the whole tree keeps type-checking against
 * genuine WXT types even though the bundle links against the shims.
 */

import { fileURLToPath } from "node:url"
import path from "node:path"
import process from "node:process"
import react from "@vitejs/plugin-react"
import ViteYaml from "@modyfi/vite-plugin-yaml"
import { defineConfig } from "vite"
// @ts-expect-error -- plain .mjs build helper, no type declarations
import { inlineAssetsPlugin } from "./scripts/userscript/vite-plugin-inline-assets.mjs"

const rootDir = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.resolve(rootDir, "src")

// The fork's own GitHub Pages deployment (see .github/workflows/userscript.yml,
// which publishes dist/dashboard to the `dashboard` branch). Overridable at
// build time, and at runtime from the script-manager menu, so a local or
// self-hosted dashboard needs no rebuild.
const DASHBOARD_URL =
  process.env.RF_DASHBOARD_URL ?? "https://rong6.github.io/read-frog/"

export default defineConfig({
  root: rootDir,
  publicDir: false,

  resolve: {
    alias: [
      // WXT magic imports -> our shims.
      { find: /^#imports$/, replacement: path.resolve(srcDir, "userscript/shim/imports.ts") },
      // Cross-context messaging collapses into a same-context bus.
      {
        find: /^@webext-core\/messaging$/,
        replacement: path.resolve(srcDir, "userscript/shim/messaging.ts"),
      },
      // No telemetry from a third-party redistribution. See the stub's header.
      {
        find: /^posthog-js\/dist\/module\.no-external$/,
        replacement: path.resolve(srcDir, "userscript/stubs/posthog.ts"),
      },
      // S1: side.content/selection.content do bare `import "…/theme.css"`. Under
      // WXT that CSS went into the shadow root only (cssInjectionMode: "ui").
      // Here it would land in the emitted stylesheet and get applied to every
      // page the script matches — Tailwind Preflight would reset the layout of
      // the entire web. `shim/ui-css.ts` already feeds these same files into the
      // shadow roots via `?inline`, so the bare form is stubbed out.
      // Note: an exact-string alias does NOT match the `?inline` variant, which
      // is precisely what lets the two coexist.
      {
        find: "@/assets/styles/theme.css",
        replacement: path.resolve(srcDir, "userscript/shim/empty.css"),
      },
      {
        find: "@/assets/styles/text-small.css",
        replacement: path.resolve(srcDir, "userscript/shim/empty.css"),
      },
      { find: "@", replacement: srcDir },
    ],
    dedupe: [
      "react",
      "react-dom",
      // CodeMirror throws "Unrecognized extension value in extension set" if the
      // bundle contains more than one copy of these (upstream issue #1782).
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
    // The extension branched on its build target in a few places (Edge review
    // URL, Edge TTS support, Firefox analytics default). "chrome" is the closest
    // match for a Chromium-hosted userscript and keeps Edge TTS enabled.
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
    __RF_DASHBOARD_URL__: JSON.stringify(DASHBOARD_URL),
    __RF_RESOLVE_DASHBOARD_FROM_LOCATION__: "false",
  },

  // WXT_* variables are read through `@/env`; let Vite expose them the same way
  // WXT did, so a .env file keeps working for both builds.
  envPrefix: ["VITE_", "WXT_"],

  plugins: [inlineAssetsPlugin(), react(), ViteYaml()],

  build: {
    target: "es2022",
    outDir: path.resolve(rootDir, "dist/userscript"),
    emptyOutDir: true,
    // One file, or it is not a userscript.
    cssCodeSplit: false,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    sourcemap: false,
    minify: "esbuild",
    reportCompressedSize: false,
    lib: {
      entry: path.resolve(srcDir, "userscript/main.ts"),
      formats: ["iife"],
      name: "ReadFrogUserscript",
      fileName: () => "read-frog.raw.js",
    },
    rollupOptions: {
      output: {
        // A userscript manager evaluates the file as-is; no import statements,
        // no code splitting, no dynamic chunks.
        inlineDynamicImports: true,
        assetFileNames: "[name][extname]",
      },
    },
  },
})
