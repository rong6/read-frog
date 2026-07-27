/**
 * Standalone home for the `browser.storage.session.onChanged` event so the
 * storage shim and the browser shim can both reach it without importing each
 * other.
 */
import { EventShim } from "./events"

export interface StorageChange {
  oldValue?: unknown
  newValue?: unknown
}

export type StorageAreaName = "local" | "session" | "sync"

export const sessionStorageOnChanged = new EventShim<[Record<string, StorageChange>]>(
  "storage.session.onChanged",
)

export const localStorageOnChanged = new EventShim<[Record<string, StorageChange>]>(
  "storage.local.onChanged",
)

export const syncStorageOnChanged = new EventShim<[Record<string, StorageChange>]>(
  "storage.sync.onChanged",
)

/**
 * `browser.storage.onChanged` — the area-agnostic one. Unlike the per-area
 * events it receives `(changes, areaName)`, so listeners that branch on the area
 * behave correctly rather than silently taking the `local` path.
 */
export const anyStorageOnChanged = new EventShim<
  [Record<string, StorageChange>, StorageAreaName]
>("storage.onChanged")
