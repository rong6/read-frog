import { backgroundFetch } from "./background-fetch-client"

const EXTENSION_PROTOCOLS = new Set([
  "chrome-extension:",
  "moz-extension:",
  "safari-web-extension:",
])

const resolvedAssetBlobCache = new Map<string, Blob>()
const pendingAssetBlobCache = new Map<string, Promise<Blob | null>>()

const HTTP_URL_RE = /^https?:\/\//i

function isRemoteHttpUrl(value: string) {
  return HTTP_URL_RE.test(value)
}

function getCurrentPageUrl() {
  return typeof window === "undefined" ? "https://example.com/" : window.location.href
}

export function shouldProxyAssetUrl(resourceUrl: string, pageUrl = getCurrentPageUrl()) {
  if (!isRemoteHttpUrl(resourceUrl)) {
    return false
  }

  try {
    const page = new URL(pageUrl)
    if (EXTENSION_PROTOCOLS.has(page.protocol)) {
      return false
    }
    // Same-origin assets need no proxy — the page can just load them. This
    // matters for the userscript port's dashboard, which serves its own bundled
    // provider logos over http(s): without this check every one of them would
    // take a needless round-trip through GM_xmlhttpRequest.
    if (new URL(resourceUrl, pageUrl).origin === page.origin) {
      return false
    }
    return true
  } catch {
    return true
  }
}

export async function resolveContentScriptAssetBlob(resourceUrl: string) {
  if (!shouldProxyAssetUrl(resourceUrl)) {
    return null
  }

  const cachedAssetBlob = resolvedAssetBlobCache.get(resourceUrl)
  if (cachedAssetBlob) {
    return cachedAssetBlob
  }

  const pendingAssetBlob = pendingAssetBlobCache.get(resourceUrl)
  if (pendingAssetBlob) {
    return pendingAssetBlob
  }

  const assetBlobPromise = (async () => {
    try {
      const response = await backgroundFetch(resourceUrl, undefined, {
        credentials: "omit",
        responseType: "base64",
      })
      if (!response.ok) {
        return null
      }

      const assetBlob = await response.blob()
      if (assetBlob.size === 0) {
        return null
      }

      resolvedAssetBlobCache.set(resourceUrl, assetBlob)
      return assetBlob
    } catch {
      return null
    } finally {
      pendingAssetBlobCache.delete(resourceUrl)
    }
  })()

  pendingAssetBlobCache.set(resourceUrl, assetBlobPromise)
  return assetBlobPromise
}

export function clearResolvedContentScriptAssetBlobs() {
  resolvedAssetBlobCache.clear()
  pendingAssetBlobCache.clear()
}
