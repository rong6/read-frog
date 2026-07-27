/**
 * Storage-backed store for the batch request records behind the statistics UI.
 *
 * These records used to be a Dexie table, which is fine for an extension — one
 * origin for the whole app — and useless for the userscript build: the writer
 * runs inside whichever page is being translated, so IndexedDB scatters the rows
 * one database per site, and the dashboard (a static site on its own origin)
 * only ever sees its own permanently empty database.
 *
 * The WXT `storage` API has no such problem. In the extension build it is
 * `browser.storage.local`; in the userscript build it is the manager's value
 * store (`GM_setValue`), which every tab on every origin shares, and which the
 * dashboard reaches over the page bridge. One key, one set of records, the same
 * numbers everywhere. Because that backend is a key-value store with no indexes,
 * the records live as a single JSON array — affordable only because their count
 * is hard-capped below.
 */

import type { LegacyBatchRequestRecord } from "./legacy-batch-request-records"
import { storage } from "#imports"
import { db } from "@/utils/db/dexie/db"
import { logger } from "@/utils/logger"
import { IS_USERSCRIPT_RUNTIME } from "@/utils/runtime-fetch"
import { onLegacyBatchRequestRecords } from "./legacy-batch-request-records"

/** One batched translation request. Shape is unchanged from the Dexie table. */
export interface BatchRequestRecord {
  key: string
  createdAt: Date
  originalRequestCount: number
  provider: string
  model: string
}

/**
 * On-the-wire shape.
 *
 * `createdAt` is epoch milliseconds rather than a `Date` because neither backend
 * preserves one: `chrome.storage` serialises values as JSON, and GM values go
 * through `JSON.stringify` in every userscript manager. A `Date` would come back
 * as a string and `record.createdAt.toLocaleDateString()` in the charts would
 * throw.
 */
interface StoredBatchRequestRecord {
  key: string
  createdAt: number
  originalRequestCount: number
  provider: string
  model: string
}

const RECORDS_STORAGE_KEY = "local:batchRequestRecords" as const
const MIGRATED_STORAGE_KEY_BASE = "batchRequestRecordsMigratedFromDexie"

/**
 * Hard cap on retained records, enforced on every write and not just by the
 * daily cleanup alarm, so the single storage value cannot grow without bound.
 *
 * 2000 records is roughly 250 KB of JSON. Every write is a full read-modify-
 * write of that array — and in the userscript build every one of those crosses
 * the manager's IPC boundary — so the size of the array is a cost paid on the
 * translation hot path, which is why this is far below the 10000 the Dexie table
 * used to allow. It still covers the longest window the statistics pages can
 * display (60 days) for any plausible amount of translating.
 */
export const BATCH_REQUEST_RECORD_MAX_COUNT = 2000

/* ------------------------------------------------------------------ */
/* serialisation                                                       */
/* ------------------------------------------------------------------ */

function toStored(record: BatchRequestRecord): StoredBatchRequestRecord {
  return {
    key: record.key,
    createdAt: record.createdAt.getTime(),
    originalRequestCount: record.originalRequestCount,
    provider: record.provider,
    model: record.model,
  }
}

function toRecord(stored: StoredBatchRequestRecord): BatchRequestRecord {
  return {
    key: stored.key,
    createdAt: new Date(stored.createdAt),
    originalRequestCount: stored.originalRequestCount,
    provider: stored.provider,
    model: stored.model,
  }
}

/**
 * Drops anything that does not look like a record instead of trusting the
 * stored value. The store is shared with other tabs and, in the userscript
 * build, with whatever else lives in the manager's value store, and one bad
 * entry would otherwise reach the charts as an `Invalid Date`.
 */
function parseStoredRecords(value: unknown): StoredBatchRequestRecord[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is StoredBatchRequestRecord => {
    if (!entry || typeof entry !== "object") return false
    const record = entry as Partial<StoredBatchRequestRecord>
    return (
      typeof record.key === "string" &&
      typeof record.createdAt === "number" &&
      Number.isFinite(record.createdAt) &&
      typeof record.originalRequestCount === "number"
    )
  })
}

function sortByCreatedAt(records: StoredBatchRequestRecord[]): StoredBatchRequestRecord[] {
  return [...records].sort((left, right) => left.createdAt - right.createdAt)
}

function capToMaxCount(records: StoredBatchRequestRecord[]): StoredBatchRequestRecord[] {
  if (records.length <= BATCH_REQUEST_RECORD_MAX_COUNT) return records
  return sortByCreatedAt(records).slice(-BATCH_REQUEST_RECORD_MAX_COUNT)
}

/* ------------------------------------------------------------------ */
/* read / modify / write                                               */
/* ------------------------------------------------------------------ */

/**
 * Serialises read-modify-write cycles *within this context*.
 *
 * Two tabs translating at once can still lose a record: both read the same
 * array and the later write wins. That is accepted rather than fixed, because
 * the backend has no compare-and-swap to build a real lock on, and a lost record
 * only makes a statistic slightly low — it can never break a translation.
 */
let writeQueue: Promise<unknown> = Promise.resolve()

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(operation, operation)
  // Swallow rejections on the queue itself so one failure neither stalls the
  // chain nor surfaces as an unhandled rejection; the caller still sees it.
  writeQueue = result.then(
    () => {},
    () => {},
  )
  return result
}

async function readStored(): Promise<StoredBatchRequestRecord[]> {
  return parseStoredRecords(await storage.getItem<unknown>(RECORDS_STORAGE_KEY))
}

interface Mutation<T> {
  /** Returning the array that was passed in (same reference) skips the write. */
  next: StoredBatchRequestRecord[]
  result: T
}

async function mutate<T>(update: (records: StoredBatchRequestRecord[]) => Mutation<T>): Promise<T> {
  return await enqueue(async () => {
    const current = await readStored()
    const { next, result } = update(current)
    if (next !== current) {
      await storage.setItem<StoredBatchRequestRecord[]>(RECORDS_STORAGE_KEY, capToMaxCount(next))
    }
    return result
  })
}

/* ------------------------------------------------------------------ */
/* migration out of Dexie                                              */
/* ------------------------------------------------------------------ */

/**
 * The "already drained" flag.
 *
 * Dexie is origin-scoped but the userscript's storage is not, so whether the
 * legacy table has been emptied is a fact about *one origin*. A single shared
 * flag would let the first origin to start up (usually the dashboard, whose
 * database is empty) declare the migration done for every site. The extension
 * build only ever has one origin, so it keeps the bare key and existing installs
 * still migrate exactly once.
 */
function getMigratedStorageKey(): `local:${string}` {
  if (!IS_USERSCRIPT_RUNTIME) return `local:${MIGRATED_STORAGE_KEY_BASE}`
  const origin = typeof location === "undefined" ? "unknown" : location.origin
  return `local:${MIGRATED_STORAGE_KEY_BASE}:${origin}`
}

function legacyToStored(record: LegacyBatchRequestRecord): StoredBatchRequestRecord | null {
  const createdAt =
    record.createdAt instanceof Date
      ? record.createdAt.getTime()
      : typeof record.createdAt === "number"
        ? record.createdAt
        : Number.NaN

  if (typeof record.key !== "string" || !Number.isFinite(createdAt)) return null
  if (typeof record.originalRequestCount !== "number") return null

  return {
    key: record.key,
    createdAt,
    originalRequestCount: record.originalRequestCount,
    provider: typeof record.provider === "string" ? record.provider : "",
    model: typeof record.model === "string" ? record.model : "",
  }
}

let legacyImport: Promise<void> | undefined

onLegacyBatchRequestRecords((records) => {
  // Persist as soon as the upgrade hands the rows over rather than waiting for
  // someone to read statistics: the upgrade frequently runs in a context that
  // never reads them (a page being translated), and the hand-off buffer only
  // lives in memory.
  legacyImport = importLegacyRecords(records)
})

async function importLegacyRecords(records: LegacyBatchRequestRecord[]): Promise<void> {
  try {
    const imported = records
      .map(legacyToStored)
      .filter((record): record is StoredBatchRequestRecord => record !== null)
    if (!imported.length) return

    await mutate((current) => {
      // Seed an empty store only. If records are already there the copy has
      // happened (or newer data exists), and re-adding old rows would resurrect
      // what a "clear" just removed.
      if (current.length) return { next: current, result: undefined }
      return { next: imported, result: undefined }
    })
    logger.info(`Imported ${imported.length} batch request records from the legacy Dexie table`)
  } catch (error) {
    logger.error("Failed to import legacy batch request records", error)
  }
}

let migration: Promise<void> | undefined

/**
 * Runs the one-time Dexie -> storage copy. Every public operation waits on it.
 *
 * Fail-safe by construction: if anything here throws we log and carry on with
 * whatever the storage key holds (usually nothing), because losing a statistic
 * is never a reason to break the page that is trying to translate.
 */
async function ensureLegacyRecordsMigrated(): Promise<void> {
  migration ??= runLegacyMigration().catch((error) => {
    // The flag is deliberately not written on failure, so the next context that
    // starts up gets another attempt.
    logger.error("Failed to migrate batch request records out of Dexie", error)
  })
  await migration
}

async function runLegacyMigration(): Promise<void> {
  const migratedKey = getMigratedStorageKey()
  if (await storage.getItem<boolean>(migratedKey)) return

  // Opening the database is what runs the version 5 upgrade, and that upgrade is
  // what hands the legacy rows to `onLegacyBatchRequestRecords` above. Resolves
  // straight away when the database is already open.
  await db.open()
  await legacyImport

  await storage.setItem<boolean>(migratedKey, true)
}

/* ------------------------------------------------------------------ */
/* public API                                                          */
/* ------------------------------------------------------------------ */

export async function getAllBatchRequestRecords(): Promise<BatchRequestRecord[]> {
  await ensureLegacyRecordsMigrated()
  return (await readStored()).map(toRecord)
}

export async function countBatchRequestRecords(): Promise<number> {
  await ensureLegacyRecordsMigrated()
  return (await readStored()).length
}

/** Replaces any record that already carries the same key, like `Table.put`. */
export async function addBatchRequestRecords(records: BatchRequestRecord[]): Promise<void> {
  if (!records.length) return
  await ensureLegacyRecordsMigrated()

  const incoming = records.map(toStored)
  const incomingKeys = new Set(incoming.map((record) => record.key))
  await mutate((current) => ({
    next: [...current.filter((record) => !incomingKeys.has(record.key)), ...incoming],
    result: undefined,
  }))
}

export async function clearBatchRequestRecords(): Promise<void> {
  // Migrate first: a pending import landing after the clear would resurrect the
  // records the user just asked us to delete.
  await ensureLegacyRecordsMigrated()
  await enqueue(async () => {
    await storage.removeItem(RECORDS_STORAGE_KEY)
  })
}

export interface PruneBatchRequestRecordsResult {
  deletedByCount: number
  deletedByAge: number
}

/**
 * Retention pass for the cleanup alarm. Age and count are applied in a single
 * read-modify-write so a concurrent write cannot slip between them.
 */
export async function pruneBatchRequestRecords({
  maxCount,
  maxAgeDays,
}: {
  maxCount: number
  maxAgeDays: number
}): Promise<PruneBatchRequestRecordsResult> {
  await ensureLegacyRecordsMigrated()

  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays)
  const cutoff = cutoffDate.getTime()

  return await mutate((current) => {
    const withinAge = current.filter((record) => record.createdAt >= cutoff)
    const retained =
      withinAge.length > maxCount ? sortByCreatedAt(withinAge).slice(-maxCount) : withinAge

    return {
      next: retained.length === current.length ? current : retained,
      result: {
        deletedByAge: current.length - withinAge.length,
        deletedByCount: withinAge.length - retained.length,
      },
    }
  })
}
