/**
 * Key-value backend for the storage shim — bridge-backed (dashboard build).
 *
 * Same interface as `./kv`, but every operation is a round-trip to the
 * userscript running on this page. `vite.dashboard.config.ts` aliases `./kv`
 * here, so nothing above this file changes between the two builds.
 *
 * A short in-memory cache smooths over the fact that each read is now an async
 * `postMessage` hop: the config atoms re-read the same key frequently, and the
 * bridge pushes change events so the cache never goes stale.
 */

import type { KeyValueBackend } from "./kv"
import { bridge } from "../bridge/client"

const cache = new Map<string, unknown>()
const cached = new Set<string>()

function primeCacheInvalidation(key: string) {
  if (invalidationInstalled.has(key)) return
  invalidationInstalled.add(key)
  bridge.watch(key, (newValue) => {
    cache.set(key, newValue)
    cached.add(key)
  })
}

const invalidationInstalled = new Set<string>()

export const kv: KeyValueBackend = {
  async get<T>(key: string): Promise<T | undefined> {
    if (cached.has(key)) return cache.get(key) as T | undefined
    return await kv.getFresh<T>(key)
  },

  async getFresh<T>(key: string): Promise<T | undefined> {
    const value = await bridge.getValue<T>(key)
    cache.set(key, value)
    cached.add(key)
    primeCacheInvalidation(key)
    return value
  },

  async set(key, value) {
    cache.set(key, value)
    cached.add(key)
    primeCacheInvalidation(key)
    await bridge.setValue(key, value)
  },

  async delete(key) {
    cache.delete(key)
    cached.delete(key)
    await bridge.deleteValue(key)
  },

  list: () => bridge.listValues(),

  onChange: (key, handler) => {
    primeCacheInvalidation(key)
    // Forward the real `remote` flag rather than asserting `true`: the storage
    // shim uses it to suppress the echo of a same-tab write, which it cannot do
    // if every change claims to have come from elsewhere.
    return bridge.watch(key, (newValue, oldValue, remote) => handler(newValue, oldValue, remote))
  },
}
