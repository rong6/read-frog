/**
 * Low-level WebDAV client (GET / PUT / PROPFIND / MKCOL) used by the config-sync
 * feature. Mirrors `src/utils/google-drive/api.ts`: every function logs through
 * `logger` and throws a descriptive error, leaving policy decisions to the
 * `storage`/`sync` layers above it.
 *
 * All requests go through `runtimeFetch` rather than the page's `fetch`: WebDAV
 * servers rarely send CORS headers, and the extra methods used here (PROPFIND /
 * MKCOL) plus the `Authorization` header always trigger a preflight, which a
 * page origin will not survive. `runtimeFetch` resolves to whichever privileged
 * transport the current build has — the platform `fetch` in the extension's
 * service worker, `GM_xmlhttpRequest` in the userscript, and the relay to the
 * userscript on the dashboard, which is an ordinary web page with no GM
 * bindings of its own and so cannot call `gmFetch` directly.
 *
 * Callers pass only the non-secret `WebDAVConfig`; the password is read from its
 * own storage key inside `webdavRequest` (see `./credentials.ts`) so it never has
 * to be threaded through the config or the call sites.
 */

import type { WebDAVConfig } from "./types"
import { runtimeFetch } from "@/utils/runtime-fetch"
import { logger } from "../logger"
import { getWebDAVPassword } from "./credentials"

/** Base class for every failure surfaced by this module. */
export class WebDAVError extends Error {
  /** HTTP status that produced the error, or `null` for transport-level failures. */
  readonly status: number | null

  constructor(message: string, status: number | null = null, options?: ErrorOptions) {
    super(message, options)
    this.name = "WebDAVError"
    this.status = status
  }
}

/** 401 — the server rejected the Basic credentials. */
export class WebDAVAuthError extends WebDAVError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 401, options)
    this.name = "WebDAVAuthError"
  }
}

/**
 * The server (or the userscript manager, or something in between) refused the
 * HTTP verb. Distinct from a transport failure because it is recoverable: the
 * sync itself only needs GET and PUT, so callers can fall back.
 */
export class WebDAVMethodUnsupportedError extends WebDAVError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 405, options)
    this.name = "WebDAVMethodUnsupportedError"
  }
}

/** The request never produced a response (DNS failure, TLS error, timeout, offline). */
export class WebDAVNetworkError extends WebDAVError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, null, options)
    this.name = "WebDAVNetworkError"
  }
}

const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getlastmodified/><d:getcontentlength/></d:prop></d:propfind>`

/**
 * `btoa` only accepts latin1, so UTF-8 credentials (non-ASCII passwords) have to
 * be encoded byte-by-byte first.
 */
function buildAuthHeader(settings: WebDAVConfig, password: string): string {
  const bytes = new TextEncoder().encode(`${settings.username}:${password}`)
  let binary = ""
  for (let index = 0; index < bytes.length; index++) {
    binary += String.fromCharCode(bytes[index])
  }
  return `Basic ${btoa(binary)}`
}

function encodePathSegments(path: string): string {
  return path.split("/").filter(Boolean).map(encodeURIComponent).join("/")
}

/** Normalized server URL without a trailing slash. Throws when unusable. */
export function getBaseUrl(settings: WebDAVConfig): string {
  const url = settings.url.trim().replace(/\/+$/, "")
  if (!url) {
    throw new WebDAVError("WebDAV server URL is not configured")
  }
  if (!/^https?:\/\//i.test(url)) {
    throw new WebDAVError(`WebDAV server URL must start with http:// or https://: ${url}`)
  }
  return url
}

/** URL of the directory holding the config file, always with a trailing slash. */
export function getDirectoryUrl(settings: WebDAVConfig): string {
  const directory = encodePathSegments(settings.directory ?? "")
  return directory ? `${getBaseUrl(settings)}/${directory}/` : `${getBaseUrl(settings)}/`
}

export function getFileUrl(settings: WebDAVConfig, fileName: string): string {
  return `${getDirectoryUrl(settings)}${encodeURIComponent(fileName)}`
}

interface WebDAVRequestInit {
  method: string
  headers?: Record<string, string>
  body?: string
}

/**
 * Perform one WebDAV request. This is the single place the password is read, and
 * transport failures are converted into `WebDAVNetworkError` so callers only ever
 * have to deal with `WebDAVError` subclasses.
 */
async function webdavRequest(
  settings: WebDAVConfig,
  url: string,
  init: WebDAVRequestInit,
  operation: string,
): Promise<Response> {
  const password = await getWebDAVPassword()

  try {
    return await runtimeFetch(url, {
      method: init.method,
      headers: { Authorization: buildAuthHeader(settings, password), ...init.headers },
      body: init.body,
      // Never let an intermediate cache shadow a config we just uploaded.
      cache: "no-store",
    })
  } catch (error) {
    logger.error(`Failed to ${operation}`, error)
    const message = error instanceof Error ? error.message : String(error)
    throw new WebDAVNetworkError(`Failed to ${operation}: ${message}`, { cause: error })
  }
}

/** Convert a non-2xx response into the matching error type. */
function throwForStatus(response: Response, operation: string): never {
  if (response.status === 401) {
    throw new WebDAVAuthError(`Failed to ${operation}: invalid WebDAV username or password (401)`)
  }
  if (response.status === 403) {
    throw new WebDAVError(
      `Failed to ${operation}: the account is not allowed to access this path (403)`,
      403,
    )
  }
  throw new WebDAVError(
    `Failed to ${operation}: ${response.status} ${response.statusText}`,
    response.status,
  )
}

/**
 * Download a file. Returns `null` when the file does not exist yet, which is the
 * normal state before the first upload.
 */
export async function getFile(settings: WebDAVConfig, fileName: string): Promise<string | null> {
  const operation = `download "${fileName}"`
  const response = await webdavRequest(
    settings,
    getFileUrl(settings, fileName),
    { method: "GET" },
    operation,
  )

  if (response.status === 404 || response.status === 410) {
    return null
  }
  if (!response.ok) {
    throwForStatus(response, operation)
  }

  return await response.text()
}

/** Create or overwrite a file. The parent directory must already exist. */
export async function putFile(
  settings: WebDAVConfig,
  fileName: string,
  content: string,
): Promise<void> {
  const operation = `upload "${fileName}"`
  const response = await webdavRequest(
    settings,
    getFileUrl(settings, fileName),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: content,
    },
    operation,
  )

  // 409 Conflict is what most servers answer when the parent collection is missing.
  if (response.status === 409) {
    throw new WebDAVError(`Failed to ${operation}: the remote directory does not exist (409)`, 409)
  }
  if (!response.ok) {
    throwForStatus(response, operation)
  }
}

/**
 * PROPFIND a resource. Returns `false` when the server answers 404, `true` on the
 * 207 Multi-Status success path.
 */
export async function propfind(
  settings: WebDAVConfig,
  url: string,
  depth: "0" | "1" = "0",
): Promise<boolean> {
  const operation = `inspect "${url}"`
  const response = await webdavRequest(
    settings,
    url,
    {
      method: "PROPFIND",
      headers: { Depth: depth, "Content-Type": "application/xml; charset=utf-8" },
      body: PROPFIND_BODY,
    },
    operation,
  )

  if (response.status === 404 || response.status === 410) {
    return false
  }
  // 405/501: the server does not implement PROPFIND. Not an error we can act on
  // here — the caller decides whether to fall back to a plain GET probe.
  if (response.status === 405 || response.status === 501) {
    throw new WebDAVMethodUnsupportedError(`Failed to ${operation}: PROPFIND is not supported`)
  }
  if (!response.ok) {
    throwForStatus(response, operation)
  }

  return true
}

/**
 * MKCOL a single collection. A 405 means the collection already exists, which is
 * a success for our purposes.
 */
export async function mkcol(settings: WebDAVConfig, url: string): Promise<void> {
  const operation = `create directory "${url}"`
  const response = await webdavRequest(settings, url, { method: "MKCOL" }, operation)

  // 405 Method Not Allowed / 301 Moved Permanently: the collection is already
  // there, or the server does not do MKCOL. Either way there is nothing to do.
  if (response.status === 405 || response.status === 301 || response.status === 501) {
    return
  }
  if (!response.ok) {
    throwForStatus(response, operation)
  }
}

/** Create every missing level of the configured sub-directory. */
export async function ensureDirectory(settings: WebDAVConfig): Promise<void> {
  const segments = (settings.directory ?? "").split("/").filter(Boolean)
  let current = `${getBaseUrl(settings)}/`

  for (const segment of segments) {
    current += `${encodeURIComponent(segment)}/`
    try {
      await mkcol(settings, current)
    } catch (error) {
      // MKCOL is the other non-standard verb, and plenty of setups reject it —
      // a reverse proxy filtering WebDAV methods, or a share where the folder
      // already exists and cannot be re-created. Neither is fatal: if the
      // directory really is missing, the PUT that follows fails loudly and with
      // a far more useful message than "MKCOL failed".
      if (error instanceof WebDAVNetworkError || error instanceof WebDAVMethodUnsupportedError) {
        logger.warn(`[WebDAV] could not create "${current}", continuing anyway`, error)
        continue
      }
      throw error
    }
  }
}

/**
 * Validate the endpoint end to end: the base URL must be reachable with the given
 * credentials, and the target sub-directory must exist (created when missing).
 */
export async function testConnection(settings: WebDAVConfig): Promise<void> {
  try {
    await probeReachable(settings)
    await ensureDirectory(settings)
  } catch (error) {
    logger.error("WebDAV connection test failed", error)
    throw error
  }
}

/**
 * Confirm the endpoint answers with these credentials.
 *
 * PROPFIND is the correct WebDAV way to ask, so it is tried first: it validates
 * the base URL *and* the credentials in one request. But reverse proxies filter
 * WebDAV verbs routinely, and config sync itself only ever issues GET and PUT —
 * so a refused PROPFIND must not condemn a perfectly working endpoint.
 *
 * The fallback GETs the base URL. Any HTTP response at all, including a 404,
 * proves the host is reachable and speaking HTTP over TLS; a 401 still proves
 * the credentials are wrong. What it cannot prove is that the *path* is a real
 * WebDAV collection, so that caveat is logged rather than quietly ignored.
 */
async function probeReachable(settings: WebDAVConfig): Promise<void> {
  const base = `${getBaseUrl(settings)}/`

  try {
    if (await propfind(settings, base)) return
    throw new WebDAVError(`WebDAV server URL not found: ${getBaseUrl(settings)} (404)`, 404)
  } catch (error) {
    const verbRefused =
      error instanceof WebDAVMethodUnsupportedError || error instanceof WebDAVNetworkError
    if (!verbRefused) throw error

    logger.warn(
      "[WebDAV] PROPFIND did not work; falling back to a GET probe. " +
        "Something between here and the server is filtering WebDAV methods — " +
        "sync itself only needs GET and PUT, so this is survivable.",
      error,
    )

    // A raw GET on the collection, not on the config file: a 404 from a nested
    // path would be ambiguous (missing file vs. wrong base URL), whereas the
    // response to the base URL says something about the base URL.
    const response = await webdavRequest(settings, base, { method: "GET" }, `reach "${base}"`)

    if (response.status === 401) {
      throw new WebDAVAuthError(
        `Failed to reach "${base}": invalid WebDAV username or password (401)`,
      )
    }
    if (response.status === 403) {
      throw new WebDAVError(
        `Failed to reach "${base}": the account is not allowed to access this path (403)`,
        403,
      )
    }

    // Everything else — 200, a directory listing, a redirect, even 404/405 — means
    // the server answered us. Combined with credentials that were not rejected,
    // that is as much as GET can establish.
    logger.info(
      `[WebDAV] reachable via GET (status ${response.status}); ` +
        "the directory itself could not be verified without PROPFIND.",
    )
  }
}
