/**
 * Dashboard-build replacement for `@/utils/content-script/background-asset-url`.
 *
 * The original exists for one reason: a content script injected into somebody
 * else's page cannot rely on being allowed to load a remote image, because the
 * host page's Content-Security-Policy governs it. So it fetches the bytes
 * through the privileged context, base64s them across the message boundary,
 * rebuilds a Blob, decodes it with `createImageBitmap`, and paints it onto a
 * canvas.
 *
 * None of that applies here. The dashboard is our own page with no hostile CSP,
 * and an `<img>` tag is not CORS-gated — so the provider logos can simply be
 * loaded the way any web page loads an image. Short-circuiting `shouldProxyAssetUrl`
 * to `false` makes `ProviderIcon` take its `{ kind: "src" }` path and skip the
 * whole chain.
 *
 * That chain had five places to fail silently (every one of them swallows its
 * error and yields a blank circle): the GM request needing the CDN host in
 * `@connect`, the bridge round-trip, base64 encode/decode, `createImageBitmap`
 * on a WebP, and the canvas draw. Deleting it is a better fix than hardening it.
 */

export function shouldProxyAssetUrl(_resourceUrl: string, _pageUrl?: string): boolean {
  return false
}

export async function resolveContentScriptAssetBlob(_resourceUrl: string): Promise<Blob | null> {
  // Unreachable while `shouldProxyAssetUrl` is false, but kept so the module's
  // shape matches the one it replaces.
  return null
}

export function clearResolvedContentScriptAssetBlobs(): void {}
