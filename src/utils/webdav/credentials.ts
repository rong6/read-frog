/**
 * Storage for the WebDAV password.
 *
 * The password is kept OUT of `config.webdav` on purpose, mirroring how
 * `google-drive/auth.ts` keeps the OAuth token in its own storage key rather
 * than in the config. Everything inside `config` is
 *   - uploaded verbatim to the sync target (`read-frog-config.json`),
 *   - rendered field-by-field in the conflict-resolution tree,
 *   - written into config exports (`getObjectWithoutAPIKeys` only strips
 *     literal `apiKey` fields), and
 *   - snapshotted into the hourly config-backup history.
 * A plaintext password must not travel through any of those paths, so it lives
 * behind `WEBDAV_PASSWORD_STORAGE_KEY` in local storage instead.
 */

import { storage } from "#imports"
import { WEBDAV_PASSWORD_STORAGE_KEY } from "../constants/config"
import { logger } from "../logger"

/** Returns the stored password, or an empty string when none has been set. */
export async function getWebDAVPassword(): Promise<string> {
  try {
    const password = await storage.getItem<string>(`local:${WEBDAV_PASSWORD_STORAGE_KEY}`)
    return password ?? ""
  } catch (error) {
    logger.error("Failed to get WebDAV password from storage", error)
    return ""
  }
}

/** Persists the password. An empty string clears it instead of storing "". */
export async function setWebDAVPassword(password: string): Promise<void> {
  try {
    if (!password) {
      await clearWebDAVPassword()
      return
    }
    await storage.setItem<string>(`local:${WEBDAV_PASSWORD_STORAGE_KEY}`, password)
  } catch (error) {
    logger.error("Failed to save WebDAV password to storage", error)
    throw error
  }
}

export async function clearWebDAVPassword(): Promise<void> {
  try {
    await storage.removeItem(`local:${WEBDAV_PASSWORD_STORAGE_KEY}`)
  } catch (error) {
    logger.error("Failed to clear WebDAV password", error)
    throw error
  }
}
