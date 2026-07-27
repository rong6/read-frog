/**
 * The WebDAV endpoint form (server URL / username / password / remote directory).
 *
 * Google Drive has no equivalent — its identity comes from an OAuth flow — so
 * this is the one piece of the card without a Drive counterpart. Each field is a
 * local draft that is persisted on change, following the same "draft + reset when
 * the stored value changes externally" pattern used elsewhere in the options page
 * (see `pages/translation/request-rate.tsx`).
 *
 * Note the two different backing stores: URL / username / directory live in
 * `config.webdav`, while the password is written to its own storage key through
 * `webdavPasswordAtom` so it never enters a config object.
 */

import type { WebDAVConfig } from "@/utils/webdav/types"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { useState } from "react"
import { Field, FieldContent, FieldGroup, FieldLabel } from "@/components/ui/base-ui/field"
import { Input } from "@/components/ui/base-ui/input"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { webdavPasswordAtom } from "@/utils/atoms/webdav-password"
import { i18n } from "@/utils/i18n"

/** Config-backed fields. The password is handled separately, see `PasswordInput`. */
type WebDAVTextField = "url" | "username" | "directory"

// Resolve labels lazily (thunks) so a runtime UI-language switch re-reads them at render
// instead of freezing the strings at module-import time.
const fieldInfo: Record<WebDAVTextField, { label: () => string; placeholder: () => string }> = {
  url: {
    label: () => i18n.t("options.config.sync.webdav.serverUrl"),
    placeholder: () => i18n.t("options.config.sync.webdav.serverUrlPlaceholder"),
  },
  username: {
    label: () => i18n.t("options.config.sync.webdav.username"),
    placeholder: () => i18n.t("options.config.sync.webdav.usernamePlaceholder"),
  },
  directory: {
    label: () => i18n.t("options.config.sync.webdav.directory"),
    placeholder: () => i18n.t("options.config.sync.webdav.directoryPlaceholder"),
  },
}

export function ConnectionFields({ disabled }: { disabled: boolean }) {
  return (
    <FieldGroup className="w-full">
      <WebDAVTextInput property="url" disabled={disabled} />
      <WebDAVTextInput property="username" disabled={disabled} />
      <PasswordInput disabled={disabled} />
      <WebDAVTextInput property="directory" disabled={disabled} />
    </FieldGroup>
  )
}

interface WebDAVTextInputProps {
  property: WebDAVTextField
  disabled: boolean
}

function WebDAVTextInput({ property, disabled }: WebDAVTextInputProps) {
  const [webdav, setWebDAV] = useAtom(configFieldsAtomMap.webdav)
  const info = fieldInfo[property]

  return (
    <TextField
      id={`webdav-${property}`}
      label={info.label()}
      placeholder={info.placeholder()}
      type="text"
      disabled={disabled}
      storedValue={readField(webdav, property)}
      onValueChange={(value) => {
        void setWebDAV(withField(webdav, property, value))
      }}
    />
  )
}

function PasswordInput({ disabled }: { disabled: boolean }) {
  const password = useAtomValue(webdavPasswordAtom)
  const setPassword = useSetAtom(webdavPasswordAtom)

  return (
    <TextField
      id="webdav-password"
      label={i18n.t("options.config.sync.webdav.password")}
      placeholder={i18n.t("options.config.sync.webdav.passwordPlaceholder")}
      type="password"
      disabled={disabled}
      storedValue={password}
      onValueChange={(value) => {
        void setPassword(value)
      }}
    />
  )
}

interface TextFieldProps {
  id: string
  label: string
  placeholder: string
  type: "text" | "password"
  disabled: boolean
  /** The persisted value; the input keeps its own draft of it. */
  storedValue: string
  onValueChange: (value: string) => void
}

function TextField({
  id,
  label,
  placeholder,
  type,
  disabled,
  storedValue,
  onValueChange,
}: TextFieldProps) {
  const [inputValue, setInputValue] = useState(storedValue)
  const [prevStoredValue, setPrevStoredValue] = useState(storedValue)

  // Reset the draft input when the stored value changes externally
  if (prevStoredValue !== storedValue) {
    setPrevStoredValue(storedValue)
    setInputValue(storedValue)
  }

  return (
    <Field orientation="responsive">
      <FieldContent className="self-center">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
      </FieldContent>
      <Input
        id={id}
        className="w-full shrink-0 sm:w-72"
        type={type}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        placeholder={placeholder}
        value={inputValue}
        onChange={(e) => {
          const rawValue = e.target.value
          setInputValue(rawValue)
          onValueChange(rawValue)
        }}
      />
    </Field>
  )
}

function readField(webdav: WebDAVConfig, property: WebDAVTextField): string {
  return webdav[property] ?? ""
}

/**
 * Written out per key instead of using a computed property so the patch stays
 * fully typed as a `WebDAVConfig` (a computed key would widen it to a string
 * index signature).
 */
function withField(webdav: WebDAVConfig, property: WebDAVTextField, value: string): WebDAVConfig {
  if (property === "url") return { ...webdav, url: value }
  if (property === "username") return { ...webdav, username: value }
  return { ...webdav, directory: value }
}
