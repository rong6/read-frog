/**
 * Zod schema and type for the non-secret WebDAV connection settings persisted in
 * the user config under `config.webdav`.
 *
 * The password is deliberately NOT part of this schema. It follows the Google
 * Drive precedent, where the OAuth token lives outside the config in its own
 * storage key (`GOOGLE_DRIVE_TOKEN_STORAGE_KEY`): anything inside `config` is
 * uploaded to the sync target, rendered in the conflict-resolution tree, written
 * to config exports and kept in the config-backup history. See
 * `./credentials.ts` for where the password actually lives.
 *
 * This module lives next to the WebDAV client because every consumer of these
 * settings is in this folder; `configSchema` simply imports the schema.
 */

import { z } from "zod"

/** Sub-directory created under the server URL when the user does not pick one. */
export const DEFAULT_WEBDAV_DIRECTORY = "read-frog"

// `.default(...)` on the object is load-bearing: it lets configs stored before this
// field existed still parse successfully, avoiding the destructive
// fallback-to-DEFAULT_CONFIG path in `writeConfigAtom` / `initializeConfig` during
// the upgrade window (same trick as `uiLanguageSchema`).
export const webdavConfigSchema = z
  .object({
    /** Base URL of the WebDAV collection, e.g. `https://dav.example.com/remote.php/dav/files/me`. */
    url: z.string(),
    username: z.string(),
    /** Optional sub-directory below `url`. May be nested, e.g. `apps/read-frog`. */
    directory: z.string().optional(),
  })
  .default({
    url: "",
    username: "",
    directory: DEFAULT_WEBDAV_DIRECTORY,
  })

export type WebDAVConfig = z.infer<typeof webdavConfigSchema>

/**
 * True when the endpoint has enough information to attempt a request. The
 * password is not checked here: it lives outside the config, and some servers
 * accept an empty one.
 */
export function isWebDAVConfigured(settings: WebDAVConfig): boolean {
  return settings.url.trim().length > 0 && settings.username.trim().length > 0
}
