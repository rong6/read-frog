/**
 * Hand-off buffer between the Dexie version 5 upgrade and the storage-backed
 * batch request record store.
 *
 * Version 5 drops the `batchRequestRecord` table (see `dexie/app-db.ts`). The
 * rows have to be read inside that version's `upgrade()` callback — that is the
 * last moment they exist — but they cannot be *written* to the `storage` API
 * from there: awaiting a non-Dexie promise inside a `versionchange` transaction
 * lets IndexedDB auto-commit it, and Dexie still needs that transaction alive to
 * delete the object store afterwards. So the upgrader only parks the rows here
 * and the store picks them up.
 *
 * This module deliberately imports nothing: `app-db.ts` and the store both
 * depend on it, and anything heavier would close an import cycle between them.
 */

/** The legacy Dexie row shape. Values are whatever IndexedDB gave back. */
export interface LegacyBatchRequestRecord {
  key?: unknown
  createdAt?: unknown
  originalRequestCount?: unknown
  provider?: unknown
  model?: unknown
}

type LegacyRecordsHandler = (records: LegacyBatchRequestRecord[]) => void

let pendingRecords: LegacyBatchRequestRecord[] | null = null
let handler: LegacyRecordsHandler | null = null

/** Called by the version 5 upgrader with everything the legacy table held. */
export function stashLegacyBatchRequestRecords(records: LegacyBatchRequestRecord[]): void {
  if (!records.length) return
  if (handler) {
    handler(records)
    return
  }
  // The upgrade can run before the store module has been imported (any Dexie
  // access opens the database, and translation caching gets there first on a
  // page being translated), so buffer until someone claims them.
  pendingRecords = [...(pendingRecords ?? []), ...records]
}

/**
 * Registers the sink that persists drained rows. Fires immediately if the
 * upgrade already happened. Only one sink is meaningful; the store registers it.
 */
export function onLegacyBatchRequestRecords(nextHandler: LegacyRecordsHandler): void {
  handler = nextHandler
  if (!pendingRecords) return
  const records = pendingRecords
  pendingRecords = null
  nextHandler(records)
}
