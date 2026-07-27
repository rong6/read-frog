/**
 * Key-value backend for the storage shim — GM-backed (userscript build).
 *
 * The dashboard build aliases this module to `./kv-bridge`, which presents the
 * same interface but forwards to the userscript over the page bridge. Keeping
 * the swap at this level means `storage.ts` — and therefore every config atom
 * above it — is identical in both builds.
 */

import { gmDeleteValue, gmGetValue, gmListValues, gmOnValueChange, gmSetValue } from "../gm/api"

export interface KeyValueBackend {
  get: <T>(key: string) => Promise<T | undefined>
  /**
   * Read past any caching the backend does. Only needed where a value is
   * expected to change *underneath* a polling loop — the OAuth handoff, where
   * another tab writes the result. Everywhere else `get` is correct and
   * cheaper.
   */
  getFresh: <T>(key: string) => Promise<T | undefined>
  set: (key: string, value: unknown) => Promise<void>
  delete: (key: string) => Promise<void>
  list: () => Promise<string[]>
  /** Cross-context change notification. Returns a disposer. */
  onChange: (
    key: string,
    handler: (newValue: unknown, oldValue: unknown, remote: boolean) => void,
  ) => () => void
}

export const kv: KeyValueBackend = {
  get: (key) => gmGetValue(key, undefined),
  // The GM backend does not cache, so a fresh read is just a read.
  getFresh: (key) => gmGetValue(key, undefined),
  set: (key, value) => gmSetValue(key, value),
  delete: (key) => gmDeleteValue(key),
  list: () => gmListValues(),
  onChange: (key, handler) => gmOnValueChange(key, handler),
}
