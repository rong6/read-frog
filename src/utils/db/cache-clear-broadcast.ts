/**
 * Cross-origin "clear the cache" broadcast.
 *
 * The translation, summary and AI-segmentation caches stay in Dexie: they are
 * potentially large and only ever read by the page that wrote them, so keeping
 * them per-origin is right. What is *not* right is the dashboard's clear-cache
 * buttons reporting success after wiping nothing but the dashboard origin's own
 * empty database.
 *
 * So the dashboard publishes a command instead of doing the work: a timestamp
 * under a shared `storage` key. Every page's background watches that key —
 * `storage.watch` is backed by `GM_addValueChangeListener` in the userscript
 * build, which fires across tabs *and* origins — and clears its own database
 * when the timestamp moves. Pages that were not open at the time cannot react,
 * so each page also compares the command against a locally persisted "last
 * applied" value at startup and honours anything still pending.
 *
 * All of this is inert in the extension build (one origin, one database, the
 * `onMessage` handler already does the job) — see `IS_USERSCRIPT_RUNTIME`.
 */

import { storage } from "#imports"
import { logger } from "@/utils/logger"
import { IS_USERSCRIPT_RUNTIME } from "@/utils/runtime-fetch"

export type CacheClearCommand = "translationRelated" | "aiSegmentation"

/** Command name -> the timestamp of the most recent clear request. */
type CacheClearCommands = Partial<Record<CacheClearCommand, number>>

export type CacheClearHandlers = Record<CacheClearCommand, () => Promise<void>>

const COMMANDS_STORAGE_KEY = "local:cacheClearCommands" as const

/**
 * The "last applied" marker lives in `window.localStorage`, not in `storage`.
 *
 * It has to be origin-scoped, exactly like the databases it describes, and
 * `storage` is the one thing here that deliberately is not: a shared marker
 * would let the first origin to apply a clear silence every other origin.
 */
const APPLIED_LOCAL_STORAGE_KEY = "read-frog:appliedCacheClearCommands"

function readCommands(value: unknown): CacheClearCommands {
  if (!value || typeof value !== "object") return {}
  const commands: CacheClearCommands = {}
  for (const [command, timestamp] of Object.entries(value)) {
    if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
      commands[command as CacheClearCommand] = timestamp
    }
  }
  return commands
}

/**
 * Falls back to an in-process record when `localStorage` is unavailable (a
 * sandboxed iframe throws on access). A page in that state re-applies a pending
 * clear once per load, which is wasteful but never wrong.
 */
let appliedFallback: CacheClearCommands = {}

function readAppliedCommands(): CacheClearCommands {
  try {
    const raw = globalThis.localStorage?.getItem(APPLIED_LOCAL_STORAGE_KEY)
    if (!raw) return appliedFallback
    return readCommands(JSON.parse(raw))
  } catch {
    return appliedFallback
  }
}

function writeAppliedCommand(command: CacheClearCommand, timestamp: number): void {
  const applied = { ...readAppliedCommands(), [command]: timestamp }
  appliedFallback = applied
  try {
    globalThis.localStorage?.setItem(APPLIED_LOCAL_STORAGE_KEY, JSON.stringify(applied))
  } catch {
    /* in-memory only for this page — see appliedFallback */
  }
}

/**
 * Publishes a clear request to every other origin. No-op in the extension build.
 */
export async function broadcastCacheClear(command: CacheClearCommand): Promise<void> {
  if (!IS_USERSCRIPT_RUNTIME) return

  try {
    const commands = readCommands(await storage.getItem<unknown>(COMMANDS_STORAGE_KEY))
    // Strictly increasing rather than plain `Date.now()`: the clocks involved
    // belong to different origins and a value that is not above the previous one
    // would be read as "already applied" and silently ignored.
    const timestamp = Math.max(Date.now(), (commands[command] ?? 0) + 1)
    await storage.setItem<CacheClearCommands>(COMMANDS_STORAGE_KEY, {
      ...commands,
      [command]: timestamp,
    })
  } catch (error) {
    logger.error("Failed to broadcast cache clear command", error)
  }
}

/** Serialises the startup pass against anything `storage.watch` delivers. */
let applyQueue: Promise<void> = Promise.resolve()

function enqueueApply(handlers: CacheClearHandlers, commands: CacheClearCommands): void {
  applyQueue = applyQueue.then(async () => {
    await applyPendingCommands(handlers, commands)
  })
}

async function applyPendingCommands(
  handlers: CacheClearHandlers,
  commands: CacheClearCommands,
): Promise<void> {
  for (const [name, timestamp] of Object.entries(commands)) {
    const command = name as CacheClearCommand
    const handler = handlers[command]
    if (!handler) continue
    if (timestamp <= (readAppliedCommands()[command] ?? 0)) continue

    try {
      await handler()
      // Only recorded once the cleanup actually succeeded, so a failure is
      // retried on the next page load instead of being marked as done.
      writeAppliedCommand(command, timestamp)
      logger.info(`Applied broadcast cache clear command: ${command}`)
    } catch (error) {
      logger.error(`Failed to apply broadcast cache clear command: ${command}`, error)
    }
  }
}

/**
 * Starts honouring clear commands for this origin. No-op in the extension build.
 *
 * Registered by every frame's background, not just the top one: a cross-origin
 * iframe has its own database and has to clear it itself. Same-origin frames
 * therefore duplicate the work, which is harmless — clearing an empty table is
 * cheap and idempotent.
 */
export function watchCacheClearCommands(handlers: CacheClearHandlers): void {
  if (!IS_USERSCRIPT_RUNTIME) return

  try {
    // `GM_addValueChangeListener` is what makes this cross-origin. A manager
    // without it (Greasemonkey 4) simply falls back to the startup catch-up
    // below, so a clear lands on the page's next load instead of immediately.
    storage.watch<unknown>(COMMANDS_STORAGE_KEY, (newValue) => {
      enqueueApply(handlers, readCommands(newValue))
    })
  } catch (error) {
    logger.error("Failed to watch cache clear commands", error)
  }

  void (async () => {
    try {
      // Catches up on a clear that was requested while this page was closed.
      // This races with a translation starting in the same moment; the worst
      // case is a cache entry written milliseconds too early being dropped,
      // which costs one re-translation.
      enqueueApply(handlers, readCommands(await storage.getItem<unknown>(COMMANDS_STORAGE_KEY)))
    } catch (error) {
      logger.error("Failed to read pending cache clear commands", error)
    }
  })()
}
