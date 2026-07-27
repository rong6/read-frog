/**
 * Persistence for the WebDAV sync base — the snapshot of the config as it looked
 * the last time this device and the WebDAV server agreed.
 *
 * This is the WebDAV twin of `src/utils/config/sync.ts`. It deliberately uses its
 * own storage key (`WEBDAV_LAST_SYNCED_CONFIG_STORAGE_KEY`): if both backends
 * shared one key, syncing to Drive would destroy WebDAV's three-way-merge base
 * (and vice versa), turning every subsequent sync into a spurious conflict.
 */

import type { Config } from "@/types/config/config"
import type {
  WebDAVLastSyncedConfigMeta,
  WebDAVLastSyncedConfigValueAndMeta,
} from "@/types/config/meta"
import { storage } from "#imports"
import { migrateConfig } from "../config/migration"
import { WEBDAV_LAST_SYNCED_CONFIG_STORAGE_KEY } from "../constants/config"
import { logger } from "../logger"

export async function getWebDAVLastSyncedConfigAndMeta(): Promise<WebDAVLastSyncedConfigValueAndMeta | null> {
  const [rawValue, meta] = await Promise.all([
    storage.getItem<unknown>(`local:${WEBDAV_LAST_SYNCED_CONFIG_STORAGE_KEY}`),
    storage.getMeta<WebDAVLastSyncedConfigMeta>(`local:${WEBDAV_LAST_SYNCED_CONFIG_STORAGE_KEY}`),
  ])

  if (!rawValue || !meta) {
    return null
  }

  try {
    const value = await migrateConfig(rawValue, meta.schemaVersion)
    return { value, meta }
  } catch (error) {
    logger.error("Failed to migrate last synced WebDAV config", error)
    return null
  }
}

export async function setWebDAVLastSyncConfigAndMeta(
  value: Config,
  meta: Partial<WebDAVLastSyncedConfigMeta>,
): Promise<void> {
  const lastSyncedAt = meta.lastSyncedAt ?? Date.now()

  await Promise.all([
    storage.setItem<Config>(`local:${WEBDAV_LAST_SYNCED_CONFIG_STORAGE_KEY}`, value),
    storage.setMeta<Partial<WebDAVLastSyncedConfigMeta>>(
      `local:${WEBDAV_LAST_SYNCED_CONFIG_STORAGE_KEY}`,
      { ...meta, lastSyncedAt },
    ),
  ])
}
