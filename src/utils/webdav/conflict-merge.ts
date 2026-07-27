/**
 * Three-way config merge for WebDAV sync.
 *
 * `src/utils/google-drive/conflict-merge.ts` is entirely generic over `Config` —
 * it never touches Drive tokens, files or the Drive API — so it is re-exported
 * verbatim here instead of being duplicated. This module exists only so the
 * WebDAV feature's imports stay symmetrical with the Drive feature's; if the
 * merge algorithm ever needs to diverge, it can be forked here without touching
 * any call site.
 */

export type {
  ApplyResolutionsResult,
  DiffConflictsResult,
  FieldConflict,
} from "../google-drive/conflict-merge"
export { applyResolutions, detectConflicts } from "../google-drive/conflict-merge"
