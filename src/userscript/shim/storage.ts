/**
 * WXT `storage` API implemented on top of the userscript manager's value store.
 *
 * Area mapping:
 *   `local:`   -> GM_getValue/GM_setValue (persisted, shared across every tab)
 *   `sync:`    -> same as `local:` (userscript managers have no sync area; the
 *                 WebDAV/Drive sync features cover that use case explicitly)
 *   `session:` -> in-memory, per tab. The extension's `session` area is shared
 *                 between the service worker and all tabs; in a userscript there
 *                 is no shared context, and every consumer of `session:` here is
 *                 a cache or per-tab translation state, so per-tab is correct.
 *
 * Change notification uses `GM_addValueChangeListener` where available (gives us
 * genuine cross-tab reactivity, which is what the config atoms rely on) plus a
 * local emitter so same-tab writes fire synchronously.
 */

import { kv } from "@/userscript/shim/kv"
import {
  anyStorageOnChanged,
  localStorageOnChanged,
  sessionStorageOnChanged,
  syncStorageOnChanged,
} from "./session-events"

type StorageArea = "local" | "session" | "sync" | "managed"
export type StorageItemKey = `${StorageArea}:${string}`

const GM_PREFIX = "rf:"
const META_SUFFIX = "$meta"

interface ParsedKey {
  area: StorageArea
  name: string
}

function parseKey(key: string): ParsedKey {
  const index = key.indexOf(":")
  if (index === -1) {
    throw new Error(
      `[read-frog] Storage key "${key}" is missing an area prefix (expected "local:" / "session:" / "sync:").`,
    )
  }
  const area = key.slice(0, index) as StorageArea
  const name = key.slice(index + 1)
  return { area, name }
}

/** Session area lives only in this tab. */
const sessionStore = new Map<string, unknown>()
const sessionMeta = new Map<string, Record<string, unknown>>()

function isSession(area: StorageArea) {
  return area === "session"
}

function gmKey(area: StorageArea, name: string) {
  // `sync:` intentionally collapses onto the same physical key space as `local:`.
  const bucket = area === "session" ? "session" : "local"
  return `${GM_PREFIX}${bucket}:${name}`
}

/* ------------------------------------------------------------------ */
/* watchers                                                            */
/* ------------------------------------------------------------------ */

type Watcher = (newValue: any, oldValue: any) => void

const watchers = new Map<string, Set<Watcher>>()
const remoteDisposers = new Map<string, () => void>()

function notify(fullKey: string, newValue: unknown, oldValue: unknown) {
  const { area, name } = parseKey(fullKey)

  // Mirror into the `browser.storage.<area>.onChanged` events that
  // background/context-menu.ts and background/browser-action-icon.ts listen on.
  const change = { [name]: { newValue: newValue ?? undefined, oldValue: oldValue ?? undefined } }
  if (area === "session") sessionStorageOnChanged.dispatch(change)
  else if (area === "sync") syncStorageOnChanged.dispatch(change)
  else localStorageOnChanged.dispatch(change)
  if (area !== "managed") anyStorageOnChanged.dispatch(change, area)

  const set = watchers.get(fullKey)
  if (!set) return
  for (const watcher of [...set]) {
    try {
      watcher(newValue, oldValue)
    } catch (error) {
      console.error("[read-frog] storage watcher threw", error)
    }
  }
}

function ensureRemoteBridge(fullKey: string, area: StorageArea, name: string) {
  if (isSession(area) || remoteDisposers.has(fullKey)) return
  const dispose = kv.onChange(gmKey(area, name), (newValue, oldValue, remote) => {
    // Same-tab writes are already announced synchronously by setItem/removeItem.
    if (!remote) return
    notify(fullKey, newValue ?? null, oldValue ?? null)
  })
  remoteDisposers.set(fullKey, dispose)
}

/* ------------------------------------------------------------------ */
/* core operations                                                     */
/* ------------------------------------------------------------------ */

async function readRaw(area: StorageArea, name: string): Promise<unknown> {
  if (isSession(area)) {
    return sessionStore.has(name) ? sessionStore.get(name) : null
  }
  const value = await kv.get<unknown>(gmKey(area, name))
  return value === undefined ? null : value
}

async function writeRaw(area: StorageArea, name: string, value: unknown): Promise<void> {
  if (isSession(area)) {
    sessionStore.set(name, value)
    return
  }
  await kv.set(gmKey(area, name), value)
}

async function deleteRaw(area: StorageArea, name: string): Promise<void> {
  if (isSession(area)) {
    sessionStore.delete(name)
    sessionMeta.delete(name)
    return
  }
  await kv.delete(gmKey(area, name))
  await kv.delete(`${gmKey(area, name)}${META_SUFFIX}`)
}

async function readMeta(area: StorageArea, name: string): Promise<Record<string, unknown>> {
  if (isSession(area)) {
    return sessionMeta.get(name) ?? {}
  }
  const meta = await kv.get<Record<string, unknown>>(`${gmKey(area, name)}${META_SUFFIX}`)
  return meta && typeof meta === "object" ? meta : {}
}

async function writeMeta(
  area: StorageArea,
  name: string,
  meta: Record<string, unknown>,
): Promise<void> {
  if (isSession(area)) {
    sessionMeta.set(name, meta)
    return
  }
  await kv.set(`${gmKey(area, name)}${META_SUFFIX}`, meta)
}

/* ------------------------------------------------------------------ */
/* public API (mirrors wxt/utils/storage)                              */
/* ------------------------------------------------------------------ */

export const storage = {
  async getItem<T>(key: StorageItemKey, opts?: { fallback?: T; defaultValue?: T }): Promise<T | null> {
    const { area, name } = parseKey(key)
    const value = (await readRaw(area, name)) as T | null
    if (value === null || value === undefined) {
      const fallback = opts?.fallback ?? opts?.defaultValue
      return (fallback ?? null) as T | null
    }
    return value
  },

  async getItems<T>(keys: StorageItemKey[]): Promise<{ key: StorageItemKey; value: T | null }[]> {
    return await Promise.all(
      keys.map(async (key) => ({ key, value: await storage.getItem<T>(key) })),
    )
  },

  async setItem<T>(key: StorageItemKey, value: T): Promise<void> {
    const { area, name } = parseKey(key)
    const oldValue = await readRaw(area, name)
    await writeRaw(area, name, value)
    notify(key, value, oldValue ?? null)
  },

  async setItems(items: { key: StorageItemKey; value: unknown }[]): Promise<void> {
    for (const item of items) {
      await storage.setItem(item.key, item.value)
    }
  },

  async removeItem(key: StorageItemKey, opts?: { removeMeta?: boolean }): Promise<void> {
    const { area, name } = parseKey(key)
    const oldValue = await readRaw(area, name)
    if (isSession(area)) {
      sessionStore.delete(name)
      if (opts?.removeMeta === true) sessionMeta.delete(name)
    } else {
      await kv.delete(gmKey(area, name))
      // WXT keeps metadata unless explicitly asked to drop it.
      if (opts?.removeMeta === true) {
        await kv.delete(`${gmKey(area, name)}${META_SUFFIX}`)
      }
    }
    notify(key, null, oldValue ?? null)
  },

  async removeItems(
    keys: (StorageItemKey | { key: StorageItemKey; options?: { removeMeta?: boolean } })[],
  ): Promise<void> {
    for (const entry of keys) {
      if (typeof entry === "string") {
        await storage.removeItem(entry)
      } else {
        await storage.removeItem(entry.key, entry.options)
      }
    }
  },

  async getMeta<T extends Record<string, unknown>>(key: StorageItemKey): Promise<T> {
    const { area, name } = parseKey(key)
    return (await readMeta(area, name)) as T
  },

  /** WXT merges the supplied properties into the existing metadata object. */
  async setMeta<T extends Record<string, unknown>>(key: StorageItemKey, meta: T): Promise<void> {
    const { area, name } = parseKey(key)
    const existing = await readMeta(area, name)
    await writeMeta(area, name, { ...existing, ...meta })
  },

  async removeMeta(key: StorageItemKey, properties?: string | string[]): Promise<void> {
    const { area, name } = parseKey(key)
    if (!properties) {
      await writeMeta(area, name, {})
      return
    }
    const list = Array.isArray(properties) ? properties : [properties]
    const existing = await readMeta(area, name)
    for (const property of list) delete existing[property]
    await writeMeta(area, name, existing)
  },

  async clear(area: StorageArea): Promise<void> {
    if (isSession(area)) {
      sessionStore.clear()
      sessionMeta.clear()
      return
    }
    const prefix = gmKey(area, "")
    for (const key of await kv.list()) {
      if (key.startsWith(prefix)) await kv.delete(key)
    }
  },

  async snapshot(area: StorageArea): Promise<Record<string, unknown>> {
    if (isSession(area)) return Object.fromEntries(sessionStore)
    const prefix = gmKey(area, "")
    const out: Record<string, unknown> = {}
    for (const key of await kv.list()) {
      if (!key.startsWith(prefix) || key.endsWith(META_SUFFIX)) continue
      out[key.slice(prefix.length)] = await kv.get(key)
    }
    return out
  },

  watch<T>(key: StorageItemKey, callback: (newValue: T | null, oldValue: T | null) => void): () => void {
    const { area, name } = parseKey(key)
    ensureRemoteBridge(key, area, name)

    let set = watchers.get(key)
    if (!set) {
      set = new Set()
      watchers.set(key, set)
    }
    set.add(callback as Watcher)

    return () => {
      const current = watchers.get(key)
      if (!current) return
      current.delete(callback as Watcher)
      if (current.size === 0) {
        watchers.delete(key)
        remoteDisposers.get(key)?.()
        remoteDisposers.delete(key)
      }
    }
  },

  defineItem<T>(key: StorageItemKey, options?: { fallback?: T; init?: () => T | Promise<T> }) {
    return {
      key,
      async getValue(): Promise<T | null> {
        const value = await storage.getItem<T>(key)
        if (value !== null) return value
        if (options?.init) {
          const initial = await options.init()
          await storage.setItem(key, initial)
          return initial
        }
        return (options?.fallback ?? null) as T | null
      },
      setValue: (value: T) => storage.setItem(key, value),
      removeValue: () => storage.removeItem(key),
      getMeta: () => storage.getMeta(key),
      setMeta: (meta: Record<string, unknown>) => storage.setMeta(key, meta),
      removeMeta: (properties?: string | string[]) => storage.removeMeta(key, properties),
      watch: (callback: (newValue: T | null, oldValue: T | null) => void) =>
        storage.watch<T>(key, callback),
    }
  },
}

/** Some call sites use the area-scoped shorthand (`storage.session.getItem`). */
function areaFacade(area: StorageArea) {
  const withArea = (name: string) => `${area}:${name}` as StorageItemKey
  return {
    getItem: <T>(name: string) => storage.getItem<T>(withArea(name)),
    setItem: <T>(name: string, value: T) => storage.setItem(withArea(name), value),
    removeItem: (name: string) => storage.removeItem(withArea(name)),
    getMeta: (name: string) => storage.getMeta(withArea(name)),
    setMeta: (name: string, meta: Record<string, unknown>) => storage.setMeta(withArea(name), meta),
    clear: () => storage.clear(area),
    snapshot: () => storage.snapshot(area),
    watch: <T>(name: string, callback: (newValue: T | null, oldValue: T | null) => void) =>
      storage.watch<T>(withArea(name), callback),
  }
}

Object.assign(storage, {
  local: areaFacade("local"),
  session: areaFacade("session"),
  sync: areaFacade("sync"),
})
