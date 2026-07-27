import type { LastSyncedConfigMeta, WebDAVLastSyncedConfigMeta } from "@/types/config/meta"
import { atom } from "jotai"
import { storage } from "#imports"
import {
  LAST_SYNCED_CONFIG_STORAGE_KEY,
  WEBDAV_LAST_SYNCED_CONFIG_STORAGE_KEY,
} from "../constants/config"

// internal atom for storing last sync time (from lastSyncedConfig meta)
const _lastSyncTimeBaseAtom = atom<number | null>(null)

_lastSyncTimeBaseAtom.onMount = (setAtom: (newValue: number | null) => void) => {
  void storage
    .getMeta<LastSyncedConfigMeta>(`local:${LAST_SYNCED_CONFIG_STORAGE_KEY}`)
    .then((meta) => setAtom(meta?.lastSyncedAt ?? null))

  // Add $ to the key to get the meta key for LAST_SYNCED_CONFIG_STORAGE_KEY
  const metaKey = `local:${LAST_SYNCED_CONFIG_STORAGE_KEY}$`

  const unwatch = storage.watch<LastSyncedConfigMeta>(metaKey, (newMeta, _) => {
    const meta = newMeta
    setAtom(meta?.lastSyncedAt ?? null)
  })

  return unwatch
}

// export read-only derived atom
export const lastSyncTimeAtom = atom((get) => get(_lastSyncTimeBaseAtom))

// internal atom for storing the WebDAV last sync time (from lastSyncedConfigWebdav meta)
const _webdavLastSyncTimeBaseAtom = atom<number | null>(null)

_webdavLastSyncTimeBaseAtom.onMount = (setAtom: (newValue: number | null) => void) => {
  void storage
    .getMeta<WebDAVLastSyncedConfigMeta>(`local:${WEBDAV_LAST_SYNCED_CONFIG_STORAGE_KEY}`)
    .then((meta) => setAtom(meta?.lastSyncedAt ?? null))

  // Add $ to the key to get the meta key for WEBDAV_LAST_SYNCED_CONFIG_STORAGE_KEY
  const metaKey = `local:${WEBDAV_LAST_SYNCED_CONFIG_STORAGE_KEY}$`

  const unwatch = storage.watch<WebDAVLastSyncedConfigMeta>(metaKey, (newMeta, _) => {
    const meta = newMeta
    setAtom(meta?.lastSyncedAt ?? null)
  })

  return unwatch
}

// export read-only derived atom
export const webdavLastSyncTimeAtom = atom((get) => get(_webdavLastSyncTimeBaseAtom))
