/**
 * Migration script from v086 to v087
 * - Adds the `webdav` field (WebDAV config-sync endpoint): server URL, username
 *   and the remote directory the config file is stored in. Empty values mean the
 *   feature stays switched off until the user fills in the options page form.
 * - The WebDAV password is deliberately NOT part of the config (it lives under
 *   its own storage key, like the Google Drive token), so a `password` carried by
 *   an incoming config — e.g. one written by a pre-release build, or an imported
 *   config file — is stripped here instead of being synced, exported or backed up.
 *
 * IMPORTANT: All values are hardcoded inline. Migration scripts are frozen
 * snapshots - never import constants or helpers that may change.
 */

export function migrate(oldConfig: any): any {
  if (!oldConfig || typeof oldConfig !== "object") {
    return oldConfig
  }

  const { password: _password, ...webdav } = oldConfig.webdav ?? {}

  return {
    ...oldConfig,
    webdav: {
      url: "",
      username: "",
      directory: "read-frog",
      ...webdav,
    },
  }
}
