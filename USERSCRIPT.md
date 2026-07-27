# Read Frog — userscript build

A port of the Read Frog browser extension to a Tampermonkey/Violentmonkey
userscript. It is a *port*, not a rewrite: every entrypoint, component, page and
config atom is the same source the extension builds from. What changed is the
platform layer underneath.

Two artifacts come out of it:

| Artifact | Path | What it is |
| --- | --- | --- |
| `read-frog.user.js` | `dist/userscript/` | The script itself. One self-contained file. |
| Dashboard | `dist/dashboard/` | The settings SPA (the old `options.html`) as a static site. |

---

## Build

```bash
pnpm install                 # runs `wxt prepare`, which still generates .wxt/ types
pnpm build:us                # both artifacts
```

Or separately:

```bash
pnpm build:userscript        # -> dist/userscript/read-frog.user.js
pnpm build:dashboard         # -> dist/dashboard/
pnpm dev:dashboard           # dashboard dev server, for iterating on settings UI
```

The extension build is untouched — `pnpm build`, `pnpm build:firefox`, `pnpm zip`
all still work.

### Build-time configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `RF_DASHBOARD_URL` | `https://rong6.github.io/read-frog/` | Where the dashboard is served from. Overridable here, and at runtime from the script-manager menu — so pointing an installed script at a different deployment needs no rebuild. |
| `RF_USERSCRIPT_VERSION` | package.json version | Overrides `@version`. CI appends a build counter so managers see a newer version on every publish. |
| `RF_UPDATE_URL` / `RF_DOWNLOAD_URL` | unset | Emit `@updateURL` / `@downloadURL` so managers can auto-update. |
| `WXT_GOOGLE_CLIENT_ID` | unset | Optional, and only for Google Drive sync — WebDAV needs nothing. See the sync row below. |

```bash
RF_DASHBOARD_URL=https://you.github.io/read-frog-userscript pnpm build:us
```

### Publishing from CI

`.github/workflows/userscript.yml` does the whole thing, and is **manual only** —
Actions → *Userscript - Build & Publish* → *Run workflow*. It builds both
artifacts, force-pushes `dist/dashboard/` (plus the userscript itself, so
`@updateURL` has a stable address) to an orphan `dashboard` branch, and cuts a
GitHub **pre-release** with `read-frog.user.js` attached.

One-time setup, in the repository settings:

- **Pages** → Source: *Deploy from a branch* → branch `dashboard`, folder `/ (root)`.
  The URL is then `https://rong6.github.io/read-frog/` — the branch name does not
  appear in it; project sites are always served at `<user>.github.io/<repo>/`.
- **Secrets and variables → Actions** → optionally add the secret
  `WXT_GOOGLE_CLIENT_ID` (only for Google Drive sync), and the variables
  `WXT_API_URL` / `WXT_WEBSITE_URL` if you are not using production readfrog.app.

Every other workflow in this fork is inherited from upstream and has had its
automatic triggers stripped — left alone they would publish extension releases,
close this fork's issues, and fail for want of secrets. They are still runnable
by hand.

### Install

1. Open `dist/userscript/read-frog.user.js` in a browser with Tampermonkey or
   Violentmonkey installed.
2. Host `dist/dashboard/` anywhere static — GitHub Pages, Cloudflare Pages, a
   local server. Any origin works: the script's `@match` is `*://*/*`, so it is
   already running on whatever page you deploy to.
3. On any page, open the script manager's menu → **Set dashboard URL…** and
   paste the address. It accepts `example.com/rf`, a trailing `index.html`, with
   or without the scheme.

That last step is what makes the dashboard work at all: the script compares the
current page against that address to decide whether to act as a settings bridge
(serving the page its stored config) or as a translator. Until it is set, the
dashboard shows a "userscript not detected" notice and the menu prompts for it.

The address lives in GM storage, so changing it is instant — no rebuild, no
reinstall. That is the intended way to try a deployment before committing to one.

Two things worth knowing:

- **Give the dashboard its own origin or path.** The script does not inject the
  translation UI on the dashboard page, so do not host it at the root of a site
  you also want to translate.
- **`file://` mostly works** but needs file access enabled in the manager, and
  some managers restrict `GM_xmlhttpRequest` there. A local HTTP server is the
  smoother way to test.

---

## How the port works

The extension's platform coupling turned out to be narrow: 24 files import
`#imports` (and only ever the `storage` and `browser` symbols), `chrome.*` is
never used, and cross-context traffic all goes through one
`@webext-core/messaging` protocol map. That made a thick-shim strategy viable —
replace the platform, leave the application alone.

```
src/userscript/
├── main.ts                  # does the manifest's job: which entrypoints run here, and when
├── gm/
│   ├── api.ts               # GM_* vs GM.* normalisation across managers
│   └── fetch.ts             # fetch()-compatible wrapper over GM_xmlhttpRequest (streaming)
├── shim/
│   ├── imports.ts           # the module `#imports` is aliased to
│   ├── browser.ts           # the browser.* namespace
│   ├── storage.ts           # WXT storage API over the manager's value store
│   ├── kv.ts / kv-bridge.ts # swappable KV backend (GM direct / via the page bridge)
│   ├── messaging.ts         # @webext-core/messaging as a same-context bus
│   ├── ports.ts             # runtime.connect as a local port pair
│   ├── content-script.ts    # defineContentScript / ContentScriptContext
│   └── shadow-root-ui.ts    # createShadowRootUi, WXT's DOM shape reproduced
├── runtime/                 # alarms, context menus, identity, menu commands
├── bridge/                  # userscript <-> dashboard postMessage RPC
└── dashboard/               # static-site entry for the settings SPA
```

Three shims do most of the work:

- **`storage`** is backed by `GM_setValue` with `GM_addValueChangeListener` for
  cross-tab reactivity, which is what the config atoms already expect. Every
  config read, write and watch in the app is unchanged.
- **`defineExtensionMessaging`** becomes an in-page bus. All ~102 protocol
  entries and every `sendMessage`/`onMessage` call site work as-is, because in a
  userscript "send a message to the background" is just a function call.
- **`runtime.connect`** hands out a back-to-back port pair. This is why
  `background/background-stream.ts` (737 lines of streaming protocol) and
  `content-script/port-streaming.ts` both run untouched.

### What is not shimmed

Two things needed real edits, both one-liners repeated across a few files:

- `@/utils/runtime-fetch` — privileged outbound requests (AI providers, DeepL,
  Google/Microsoft translate, Edge TTS, Drive, WebDAV, oRPC) now go through a
  single `runtimeFetch` export. It is the platform `fetch` in the extension build
  and the GM-backed one in the userscript build. Page `fetch` would be blocked by
  the host page's CORS policy and CSP.
- `providers/model.ts` passes that same fetch to the AI SDK provider factories as
  their `fetch` option. **The Vercel AI SDK is kept**, not replaced with bare
  HTTP calls. It costs bundle size, but it is what preserves streaming, structured
  outputs, reasoning tokens and all 22 providers behaving exactly as they do in
  the extension — which was the goal.

---

## Behaviour differences

Unavoidable ones, and what happens instead:

| Extension feature | Userscript | Why |
| --- | --- | --- |
| Toolbar popup | Not present | No toolbar. The floating button and dashboard cover it. |
| Side panel | Removed | Was a "coming soon" placeholder upstream anyway. |
| Toolbar icon state | Gone | No icon. |
| PostHog analytics | Stubbed to no-ops | A third-party redistribution should not report into the upstream project's analytics. All call sites and the opt-in toggle still exist. |
| `alarms` (config backup, cache cleanup) | 30s timer in the top frame with a persisted last-run stamp | No background context. Both jobs are idempotent, so a rare duplicate run across tabs is harmless. |
| Translation rate limiting | Per tab, not global | The queue was a singleton in the service worker. With N tabs open you get N× the configured rate. |
| Cookie-driven auth cache invalidation | On tab focus | Managers expose no cookie observer, so signing in or out elsewhere cannot be observed directly. The auth cache group is instead dropped when the tab becomes visible again, which covers the realistic flow (sign in, switch back). |
| Translation cache | Per site, not shared | IndexedDB is scoped to the origin that writes it. The extension had one origin for everything; a userscript writes on whichever site it is translating, so the cache does not dedupe across sites. The tables are potentially large and only ever read by the page that wrote them, so they stay put. The dashboard's "clear cache" buttons no longer lie about them: they publish a command to GM storage that every page's background applies to its own database, immediately if the page is open and on startup if it is not. |
| Statistics | Shared | The batch request records moved off IndexedDB onto GM storage, which every origin shares, so the statistics page and the batch-savings figure see every site's requests. See `src/utils/db/batch-request-record-store.ts`; records written by the pre-move build are copied over once, per origin, by Dexie version 5. |
| Right-click menu | Script-manager menu, not a real context menu | `GM_registerMenuCommand` adds entries under the manager's toolbar icon; it cannot add items to the browser's own right-click menu. Selection actions still work (they read the live selection when invoked) but are two clicks further away. A genuine right-click menu would mean intercepting `contextmenu` and drawing our own, which replaces the native menu — a deliberate UX call, not currently made. |
| Google Drive sync | Works, but isolated | `appDataFolder` is partitioned per OAuth client, so a userscript build cannot see files written by the official extension. Needs your own `WXT_GOOGLE_CLIENT_ID`. **WebDAV sync was added for this reason** and is the recommended path. If you do want Drive, you must also register `<your dashboard URL>/oauth2callback.html` as an authorized redirect URI on that client. |

Everything else — page translation, bilingual mode, selection toolbar, custom
actions, input-field translation, YouTube subtitles, all 20+ providers, site
rules, custom prompts, statistics, Notebase, the 9 UI languages, config
migrations, import/export — is the extension's own code running unchanged.

### Known rough edges (not fixed)

- **Violentmonkey in `inject-into: content` mode.** `interceptor.content` patches
  `XMLHttpRequest.prototype` to observe YouTube's `timedtext` requests. That only
  works if the script shares the page's JS realm — true for Tampermonkey, and for
  Violentmonkey in `page` mode, but not when VM falls back to content mode
  because a page's CSP blocked injection. YouTube is a plausible place for that
  to happen, and the failure is silent (subtitles just never appear). The fix is
  to patch `pageWindow.XMLHttpRequest.prototype` (`gm/api.ts` already exports
  `pageWindow`); it is not done yet because it cannot be verified here.
- **`session:` storage is per-frame, not per-tab.** The shim's session area is a
  module-level `Map`, and each frame runs its own copy of the bundle. Combined
  with every frame reporting `tab.id = 0`, tab-scoped keys collide on the same
  name while living in disjoint stores, so the top frame and an iframe cannot see
  each other's translation state. Acceptable for the current features; worth
  knowing before adding anything that needs cross-frame state.
- **`sendMessage` rejects when nothing is listening**, matching the platform. If a
  broadcast fires before its UI has mounted you will see a "Could not establish
  connection" rejection in the console rather than silence.

---

## Notes for whoever builds this next

- `wxt prepare` still runs on postinstall and still generates `.wxt/`. That is
  deliberate: TypeScript resolves `#imports` and `#i18n` to the *real* WXT types,
  so the whole tree type-checks against them even though the bundle links against
  the shims. `pnpm type-check` covers both builds.
- The userscript build is plain Vite in `lib` + `iife` mode, not WXT. WXT emits
  one bundle per entrypoint plus HTML pages and a manifest — the opposite of a
  single-file userscript. Post-processing that back into one file would have been
  more fragile than the aliases in `vite.userscript.config.ts`.
- `@run-at document-start` is required, not a preference:
  `interceptor.content` and `input-injector.content` patch page globals and must
  land before the page's own scripts. `main.ts` defers everything else to
  `DOMContentLoaded`.
- `@connect *` is in the metadata block on purpose. Users can point providers at
  arbitrary base URLs (self-hosted OpenAI-compatible endpoints, Ollama on the
  LAN, any WebDAV server), and those hosts cannot be enumerated at build time.
  The named hosts above it exist so the permission prompt is readable.
- Bundle size: expect a few MB. Comparable userscripts (immersive-translate) sit
  around 3 MB. `pnpm build:userscript` prints the figure.
