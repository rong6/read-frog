/**
 * Read/write the remote config document on a WebDAV server.
 *
 * Mirrors `src/utils/google-drive/storage.ts`: the downloaded payload is run
 * through `migrateConfig` so an older device can hand its config to a newer one,
 * `ConfigVersionTooNewError` is rethrown untouched (the UI shows a dedicated
 * "upgrade Read Frog" message for it), and any other migration failure degrades
 * to `null` so the sync can continue by uploading the local config instead.
 */

import type { WebDAVConfig } from "./types"
import type { Config } from "@/types/config/config"
import type { ConfigValueAndMeta } from "@/types/config/meta"
import { ConfigVersionTooNewError } from "../config/errors"
import { migrateConfig } from "../config/migration"
import { CONFIG_SCHEMA_VERSION } from "../constants/config"
import { logger } from "../logger"
import { getFile, putFile, WebDAVError } from "./api"
import { WEBDAV_CONFIG_FILENAME } from "./constants"

/**
 * The remote file is plain user-visible JSON on someone else's server, so its
 * shape is checked before it is handed to the migration pipeline.
 */
function parseRemoteDocument(content: string): ConfigValueAndMeta {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (error) {
    logger.error("Remote WebDAV config is not valid JSON", error)
    throw new WebDAVError(
      `Remote config file "${WEBDAV_CONFIG_FILENAME}" is not valid JSON`,
      null,
      { cause: error },
    )
  }

  const payload = parsed as Partial<ConfigValueAndMeta> | null
  if (!payload || typeof payload !== "object" || payload.value === undefined) {
    throw new WebDAVError(`Remote config file "${WEBDAV_CONFIG_FILENAME}" has an unexpected shape`)
  }
  if (!payload.meta || typeof payload.meta.schemaVersion !== "number") {
    throw new WebDAVError(`Remote config file "${WEBDAV_CONFIG_FILENAME}" is missing its metadata`)
  }

  return payload as ConfigValueAndMeta
}

export async function getRemoteConfigAndMeta(
  settings: WebDAVConfig,
): Promise<ConfigValueAndMeta | null> {
  try {
    const content = await getFile(settings, WEBDAV_CONFIG_FILENAME)

    if (content === null) {
      return null
    }

    const remoteData = parseRemoteDocument(content)

    let migratedConfig: Config
    try {
      migratedConfig = await migrateConfig(remoteData.value, remoteData.meta.schemaVersion)
    } catch (error) {
      if (error instanceof ConfigVersionTooNewError) {
        throw error
      }
      logger.error("Failed to migrate remote config", error)
      return null
    }

    return {
      value: migratedConfig,
      meta: {
        schemaVersion: CONFIG_SCHEMA_VERSION,
        lastModifiedAt: remoteData.meta.lastModifiedAt,
      },
    }
  } catch (error) {
    logger.error("Failed to get remote config", error)
    throw error
  }
}

export async function setRemoteConfigAndMeta(
  settings: WebDAVConfig,
  configValueAndMeta: ConfigValueAndMeta,
): Promise<void> {
  try {
    const content = JSON.stringify(configValueAndMeta, null, 2)
    await putFile(settings, WEBDAV_CONFIG_FILENAME, content)
  } catch (error) {
    logger.error("Failed to upload local config", error)
    throw error
  }
}
