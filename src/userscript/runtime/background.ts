/**
 * Runs the extension's background entrypoint inside the page.
 *
 * `src/entrypoints/background/index.ts` is imported and executed unmodified.
 * Everything it wires up — the translation queues, the AI text/stream handlers,
 * the proxy fetch, the Notebase pending-save processor, the config watcher —
 * works because `#imports` and `@webext-core/messaging` are aliased to the
 * shims, so its `browser.*` calls land on stubs and its `onMessage` handlers
 * register into the same in-page bus the content scripts send on.
 *
 * The two things the service worker got for free and a page does not:
 *
 *  1. `runtime.onInstalled` — the browser fired it once per install/update. We
 *     detect the equivalent from a version stamp in GM storage and dispatch it
 *     ourselves, so first-run config seeding still happens.
 *  2. Being a *singleton*. Every frame runs its own copy, so genuinely global
 *     work (alarms, the manager menu) is guarded to the top frame inside the
 *     modules that schedule it.
 */

import backgroundDefinition from "@/entrypoints/background/index"
import { ensureInitializedConfig } from "@/entrypoints/background/config"
import { disableDatabaseCleanup } from "@/entrypoints/background/db-cleanup"
import { logger } from "@/utils/logger"
import { USERSCRIPT_VERSION } from "../gm/api"
import { kv } from "@/userscript/shim/kv"
import { browserEvents } from "../shim/browser"

const VERSION_STAMP_KEY = "rf:userscript:installedVersion"

let started: Promise<void> | undefined

async function dispatchInstalledEvent() {
  let previousVersion: string | undefined
  try {
    previousVersion = await kv.get<string>(VERSION_STAMP_KEY)
  } catch {
    // A manager without GM_getValue cannot persist anything anyway; treat as
    // an install so config seeding at least runs for this session.
    previousVersion = undefined
  }

  if (previousVersion === USERSCRIPT_VERSION) return

  const reason = previousVersion ? "update" : "install"
  try {
    await kv.set(VERSION_STAMP_KEY, USERSCRIPT_VERSION)
  } catch {
    /* non-fatal */
  }

  logger.info("[Userscript] dispatching runtime.onInstalled", { reason, previousVersion })
  browserEvents.onInstalled.dispatch({ reason, previousVersion })
}

export interface StartBackgroundOptions {
  /**
   * Leave the database-cleanup alarms to somebody else.
   *
   * The alarm shim persists its "last run" stamp in GM storage, which every tab
   * and every origin running the script shares — but the Dexie database those
   * jobs prune belongs to whichever origin is doing the pruning. A context whose
   * database is not the one pages actually write to would win the claim, delete
   * nothing, and keep the tabs that *do* hold caches from cleaning up for a full
   * period. Only the Dexie-backed jobs are affected: the config backup stores
   * into GM storage, so it is correct from anywhere and always runs.
   */
  skipDatabaseCleanup?: boolean
}

export function startBackground(options: StartBackgroundOptions = {}): Promise<void> {
  started ??= (async () => {
    // Before main(), which is what registers the alarms.
    if (options.skipDatabaseCleanup) disableDatabaseCleanup()

    // Seed/migrate the config before any handler can read it. The service worker
    // relied on `onInstalled` for this, which we cannot count on firing first.
    try {
      await ensureInitializedConfig()
    } catch (error) {
      logger.error("[Userscript] config initialisation failed", error)
    }

    try {
      await backgroundDefinition.main()
    } catch (error) {
      logger.error("[Userscript] background main() failed", error)
    }

    // Only the top frame should act on install/update (it opens a tab).
    try {
      if (window.top === window.self) await dispatchInstalledEvent()
    } catch {
      /* cross-origin frame check failed — treat as a subframe and skip */
    }
  })()

  return started
}
