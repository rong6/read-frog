/**
 * Jotai binding for the WebDAV password.
 *
 * The password is not part of `config`, so it cannot ride along on
 * `configFieldsAtomMap`. This atom gives the options-page form the same
 * "controlled input, saves on change" ergonomics against its own storage key,
 * using the storage-backed `onMount` + `storage.watch` pattern from
 * `./last-sync-time.ts`.
 */

import { atom } from "jotai"
import { storage } from "#imports"
import {
  getWebDAVPassword,
  setWebDAVPassword as persistWebDAVPassword,
} from "@/utils/webdav/credentials"
import { WEBDAV_PASSWORD_STORAGE_KEY } from "../constants/config"

// internal atom holding the password currently in storage
const _webdavPasswordBaseAtom = atom<string>("")

_webdavPasswordBaseAtom.onMount = (setAtom: (newValue: string) => void) => {
  void getWebDAVPassword().then(setAtom)

  const unwatch = storage.watch<string>(`local:${WEBDAV_PASSWORD_STORAGE_KEY}`, (newPassword) => {
    setAtom(newPassword ?? "")
  })

  return unwatch
}

/**
 * Read the password, or write it through to storage. The base atom is updated
 * optimistically so the input stays responsive while the write settles.
 */
export const webdavPasswordAtom = atom(
  (get) => get(_webdavPasswordBaseAtom),
  async (_get, set, password: string) => {
    set(_webdavPasswordBaseAtom, password)
    await persistWebDAVPassword(password)
  },
)
