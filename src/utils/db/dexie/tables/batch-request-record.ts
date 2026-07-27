/**
 * Compatibility re-export of the batch request record type.
 *
 * These records are no longer a Dexie table — they moved to the shared `storage`
 * API so the dashboard can read them from its own origin (see
 * `utils/db/batch-request-record-store.ts`, and version 5 in `../app-db.ts`).
 * The path stays because the statistics components import the type from here,
 * and a type is all any of them ever needed from it.
 */

export type { BatchRequestRecord as default } from "@/utils/db/batch-request-record-store"
