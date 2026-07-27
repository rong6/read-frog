/**
 * Orchestration for WebDAV config sync.
 *
 * Deliberately a line-by-line twin of `src/utils/google-drive/sync.ts` so both
 * backends behave identically: same `SyncAction` union, same "account changed →
 * adopt remote" shortcut, same three-way conflict hand-off to the UI. The only
 * structural difference is the sync identity — Drive keys off the Google account
 * email, WebDAV keys off `username@server/directory` — and the fact that the
 * endpoint settings live in the config itself (`config.webdav`).
 */

import type { UnresolvedConfigs } from "../atoms/webdav-sync"
import type { WebDAVConfig } from "./types"
import type { Config } from "@/types/config/config"
import { dequal } from "dequal"
import { configSchema } from "@/types/config/config"
import { getLocalConfigAndMeta, setLocalConfigAndMeta } from "../config/storage"
import { CONFIG_SCHEMA_VERSION } from "../constants/config"
import { logger } from "../logger"
import { WebDAVError } from "./api"
import { getWebDAVLastSyncedConfigAndMeta, setWebDAVLastSyncConfigAndMeta } from "./last-synced"
import { getRemoteConfigAndMeta, setRemoteConfigAndMeta } from "./storage"
import { isWebDAVConfigured } from "./types"

export type SyncAction = "uploaded" | "downloaded" | "same-changes" | "no-change"

export type SyncResult =
  | { status: "success"; action: SyncAction }
  | { status: "unresolved"; data: UnresolvedConfigs }
  | { status: "error"; error: Error }

/**
 * Stable identity of a WebDAV target. Changing server, user or directory is
 * treated exactly like switching Google accounts: the merge base no longer
 * applies, so the remote wins (or the local config seeds a fresh remote).
 */
export function getWebDAVAccountId(settings: WebDAVConfig): string {
  const url = settings.url.trim().replace(/\/+$/, "")
  const directory = (settings.directory ?? "").replace(/^\/+|\/+$/g, "")
  return `${settings.username}@${url}${directory ? `/${directory}` : ""}`
}

function requireWebDAVSettings(config: Config): WebDAVConfig {
  if (!isWebDAVConfigured(config.webdav)) {
    throw new WebDAVError("WebDAV server URL and username are required before syncing")
  }
  return config.webdav
}

/**
 * Sync merged config after conflict resolution
 * - Save merged config to local storage
 * - Upload merged config to the WebDAV server
 * - Update last sync time and last synced config
 */
export async function syncMergedConfig(mergedConfig: Config, account: string): Promise<void> {
  try {
    const now = Date.now()

    // Read the endpoint from the config that is live on this device *before* the
    // merged config lands, so a merge that changed `webdav.*` cannot lock us out
    // of the upload that is supposed to publish it.
    const localConfigValueAndMeta = await getLocalConfigAndMeta()
    const settings = requireWebDAVSettings(localConfigValueAndMeta.value)

    // Validate merged config
    const validatedConfigResult = configSchema.safeParse(mergedConfig)
    if (!validatedConfigResult.success) {
      logger.error("Merged config is invalid, cannot sync merged config")
      throw new Error("Merged config is invalid for syncing")
    }

    const validatedConfig = validatedConfigResult.data

    // Save to local storage
    await setLocalConfigAndMeta(validatedConfig, {
      schemaVersion: CONFIG_SCHEMA_VERSION,
      lastModifiedAt: now,
    })

    // Upload to the WebDAV server
    await setRemoteConfigAndMeta(settings, {
      value: validatedConfig,
      meta: { schemaVersion: CONFIG_SCHEMA_VERSION, lastModifiedAt: now },
    })

    // Update sync metadata
    await setWebDAVLastSyncConfigAndMeta(validatedConfig, {
      schemaVersion: CONFIG_SCHEMA_VERSION,
      lastModifiedAt: now,
      account,
    })

    logger.info("Synced config to WebDAV successfully")
  } catch (error) {
    logger.error("Failed to sync config to WebDAV", error)
    throw error
  }
}

export async function syncConfig(): Promise<SyncResult> {
  try {
    const localConfigValueAndMeta = await getLocalConfigAndMeta()
    const settings = requireWebDAVSettings(localConfigValueAndMeta.value)
    const account = getWebDAVAccountId(settings)

    const lastSyncedConfigValueAndMeta = await getWebDAVLastSyncedConfigAndMeta()
    const remoteConfigValueAndMeta = await getRemoteConfigAndMeta(settings)

    const now = Date.now()

    if (account !== lastSyncedConfigValueAndMeta?.meta.account) {
      if (remoteConfigValueAndMeta) {
        logger.info("Remote config found, saving remote config")
        await setLocalConfigAndMeta(remoteConfigValueAndMeta.value, remoteConfigValueAndMeta.meta)
        await setWebDAVLastSyncConfigAndMeta(remoteConfigValueAndMeta.value, {
          ...remoteConfigValueAndMeta.meta,
          account,
          lastSyncedAt: now,
        })
        return { status: "success", action: "downloaded" }
      }
      logger.info("No remote config found, uploading local config")
      await setRemoteConfigAndMeta(settings, localConfigValueAndMeta)
      await setWebDAVLastSyncConfigAndMeta(localConfigValueAndMeta.value, {
        ...localConfigValueAndMeta.meta,
        account,
        lastSyncedAt: now,
      })
      return { status: "success", action: "uploaded" }
    }

    // Check if both local and remote changed since last sync
    const localChangedSinceSync =
      localConfigValueAndMeta.meta.lastModifiedAt > lastSyncedConfigValueAndMeta.meta.lastModifiedAt
    const remoteChangedSinceSync =
      remoteConfigValueAndMeta &&
      remoteConfigValueAndMeta.meta.lastModifiedAt >
        lastSyncedConfigValueAndMeta.meta.lastModifiedAt

    if (localChangedSinceSync && remoteChangedSinceSync) {
      logger.info("Both local and remote changed since last sync, checking for conflicts")

      const sameLocalAndRemote = dequal(
        localConfigValueAndMeta.value,
        remoteConfigValueAndMeta.value,
      )

      if (sameLocalAndRemote) {
        logger.info("Local and remote configurations are the same, no conflicts detected")
        const syncedAt = Date.now()

        // if the schemaVersion is different, use local config's schemaVersion
        const mergedConfigValueAndMeta = {
          value: localConfigValueAndMeta.value,
          meta: { schemaVersion: CONFIG_SCHEMA_VERSION, lastModifiedAt: syncedAt },
        }

        await setLocalConfigAndMeta(mergedConfigValueAndMeta.value, mergedConfigValueAndMeta.meta)
        await setRemoteConfigAndMeta(settings, mergedConfigValueAndMeta)
        await setWebDAVLastSyncConfigAndMeta(mergedConfigValueAndMeta.value, {
          ...mergedConfigValueAndMeta.meta,
          account,
          lastSyncedAt: now,
        })

        return { status: "success", action: "same-changes" }
      }

      return {
        status: "unresolved",
        data: {
          base: lastSyncedConfigValueAndMeta.value,
          local: localConfigValueAndMeta.value,
          remote: remoteConfigValueAndMeta.value,
        },
      }
    } else if (localChangedSinceSync) {
      logger.info("Local config is newer, uploading local config")
      await setRemoteConfigAndMeta(settings, localConfigValueAndMeta)
      await setWebDAVLastSyncConfigAndMeta(localConfigValueAndMeta.value, {
        ...localConfigValueAndMeta.meta,
        account,
        lastSyncedAt: now,
      })
      return { status: "success", action: "uploaded" }
    } else if (remoteChangedSinceSync) {
      logger.info("Remote config is newer, downloading remote config")
      await setLocalConfigAndMeta(remoteConfigValueAndMeta.value, remoteConfigValueAndMeta.meta)
      await setWebDAVLastSyncConfigAndMeta(remoteConfigValueAndMeta.value, {
        ...remoteConfigValueAndMeta.meta,
        account,
        lastSyncedAt: now,
      })
      return { status: "success", action: "downloaded" }
    }
    logger.info("No changes, skipping sync")
    await setWebDAVLastSyncConfigAndMeta(localConfigValueAndMeta.value, {
      ...localConfigValueAndMeta.meta,
      account,
      lastSyncedAt: now,
    })
    return { status: "success", action: "no-change" }
  } catch (error) {
    logger.error("Config sync failed", error)
    return {
      status: "error",
      error: error instanceof Error ? error : new Error(String(error)),
    }
  }
}

/**
 * Force-push the local config to the server, ignoring the merge base. Backs the
 * explicit "Upload" button; `syncConfig` remains the safe default.
 */
export async function uploadConfig(): Promise<SyncResult> {
  try {
    const localConfigValueAndMeta = await getLocalConfigAndMeta()
    const settings = requireWebDAVSettings(localConfigValueAndMeta.value)
    const now = Date.now()

    const configValueAndMeta = {
      value: localConfigValueAndMeta.value,
      meta: { schemaVersion: CONFIG_SCHEMA_VERSION, lastModifiedAt: now },
    }

    await setRemoteConfigAndMeta(settings, configValueAndMeta)
    await setLocalConfigAndMeta(configValueAndMeta.value, configValueAndMeta.meta)
    await setWebDAVLastSyncConfigAndMeta(configValueAndMeta.value, {
      ...configValueAndMeta.meta,
      account: getWebDAVAccountId(settings),
      lastSyncedAt: now,
    })

    return { status: "success", action: "uploaded" }
  } catch (error) {
    logger.error("Config upload failed", error)
    return {
      status: "error",
      error: error instanceof Error ? error : new Error(String(error)),
    }
  }
}

/**
 * Force-pull the remote config over the local one, ignoring the merge base.
 * Backs the explicit "Download" button.
 */
export async function downloadConfig(): Promise<SyncResult> {
  try {
    const localConfigValueAndMeta = await getLocalConfigAndMeta()
    const settings = requireWebDAVSettings(localConfigValueAndMeta.value)
    const remoteConfigValueAndMeta = await getRemoteConfigAndMeta(settings)
    const now = Date.now()

    if (!remoteConfigValueAndMeta) {
      throw new WebDAVError("No config found on the WebDAV server yet")
    }

    await setLocalConfigAndMeta(remoteConfigValueAndMeta.value, remoteConfigValueAndMeta.meta)
    await setWebDAVLastSyncConfigAndMeta(remoteConfigValueAndMeta.value, {
      ...remoteConfigValueAndMeta.meta,
      account: getWebDAVAccountId(settings),
      lastSyncedAt: now,
    })

    return { status: "success", action: "downloaded" }
  } catch (error) {
    logger.error("Config download failed", error)
    return {
      status: "error",
      error: error instanceof Error ? error : new Error(String(error)),
    }
  }
}
