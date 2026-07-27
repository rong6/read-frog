import type { Config } from "./config"

/**
 * Metadata stored with config via WXT storage.setMeta
 */
export interface ConfigMetaFields {
  schemaVersion: number
  lastModifiedAt: number
}

export interface ConfigMeta extends ConfigMetaFields, Record<string, unknown> {}

export interface ConfigValueAndMeta {
  value: Config
  meta: ConfigMeta
}

/**
 * Metadata stored with lastSyncedConfig via WXT storage.setMeta
 */
export interface LastSyncedConfigMetaFields {
  schemaVersion: number
  lastModifiedAt: number
  lastSyncedAt: number
  email: string
}

export interface LastSyncedConfigMeta extends LastSyncedConfigMetaFields, Record<string, unknown> {}

export interface LastSyncedConfigValueAndMeta {
  value: Config
  meta: LastSyncedConfigMeta
}

/**
 * Metadata stored with the WebDAV lastSyncedConfig via WXT storage.setMeta.
 *
 * Identical to `LastSyncedConfigMetaFields` except that the sync identity is the
 * WebDAV account (`username@server/directory`) rather than a Google account
 * email. WebDAV keeps its own storage key so the two backends never overwrite
 * each other's three-way-merge base.
 */
export interface WebDAVLastSyncedConfigMetaFields {
  schemaVersion: number
  lastModifiedAt: number
  lastSyncedAt: number
  account: string
}

export interface WebDAVLastSyncedConfigMeta
  extends WebDAVLastSyncedConfigMetaFields,
    Record<string, unknown> {}

export interface WebDAVLastSyncedConfigValueAndMeta {
  value: Config
  meta: WebDAVLastSyncedConfigMeta
}
