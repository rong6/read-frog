/**
 * `@webext-core/messaging` replacement for the userscript build.
 *
 * In the extension there are three contexts (background service worker, content
 * scripts, extension pages) and `sendMessage` hops between them over
 * `browser.runtime.sendMessage`. In a userscript every one of those collapses
 * into a single page context, so a message is just a function call.
 *
 * Keeping the *same* API means none of the ~102 protocol entries, and none of
 * their call sites, have to change.
 *
 * Differences worth knowing:
 *  - Multiple handlers may register the same message name (the extension allowed
 *    one per context; here "background" and "content script" share a registry).
 *    `sendMessage` resolves with the first handler that returned something other
 *    than `undefined`, which preserves both request/response and broadcast use.
 *  - With no handler at all it rejects with the same "Could not establish
 *    connection" wording the platform uses, because callers already branch on
 *    that (see `isMissingReceiverError` in background/tts-playback.ts).
 *  - `tabId` arguments are accepted and ignored: there is exactly one tab.
 *  - `sender.frameId` is synthesised from the frame's position in the page, so
 *    the existing `frameId === 0` top-frame checks keep working.
 */

export interface ShimMessageSender {
  id: string
  url: string
  origin: string
  frameId: number
  tab: { id: number; windowId: number; url: string; active: boolean }
}

export interface ShimMessage<TData> {
  id: number
  type: string
  data: TData
  timestamp: number
  sender: ShimMessageSender
}

type AnyHandler = (message: ShimMessage<any>) => any

const registry = new Map<string, Set<AnyHandler>>()

let messageCounter = 0

const IS_TOP_FRAME = (() => {
  try {
    return window.top === window.self
  } catch {
    // Cross-origin parent — we are definitely in a subframe.
    return false
  }
})()

/**
 * Stable synthetic frame id. The extension used 0 for the top frame and a
 * positive integer per subframe; only "is this the top frame" is ever actually
 * branched on, so a two-valued approximation is faithful enough.
 */
const FRAME_ID = IS_TOP_FRAME ? 0 : 1

function buildSender(): ShimMessageSender {
  return {
    id: "read-frog-userscript",
    url: location.href,
    origin: location.origin,
    frameId: FRAME_ID,
    tab: { id: 0, windowId: 0, url: location.href, active: !document.hidden },
  }
}

export function defineExtensionMessaging<TProtocolMap extends Record<string, any>>() {
  type Key = Extract<keyof TProtocolMap, string>

  function onMessage<TName extends Key>(
    name: TName,
    handler: (message: ShimMessage<any>) => any,
  ): () => void {
    let handlers = registry.get(name)
    if (!handlers) {
      handlers = new Set()
      registry.set(name, handlers)
    }
    handlers.add(handler as AnyHandler)
    return () => {
      const current = registry.get(name)
      if (!current) return
      current.delete(handler as AnyHandler)
      if (current.size === 0) registry.delete(name)
    }
  }

  async function sendMessage<TName extends Key>(
    name: TName,
    data?: any,
    _tabIdOrOptions?: unknown,
  ): Promise<any> {
    const handlers = registry.get(name)
    if (!handlers || handlers.size === 0) {
      // Same shape and wording as the platform, so existing error-matching keeps
      // working. Broadcasts into a UI that is not mounted land here too, which
      // is exactly what happened in the extension when a tab had no listener.
      throw new Error(
        `Could not establish connection. Receiving end does not exist. (message: "${name}")`,
      )
    }

    const message: ShimMessage<any> = {
      id: ++messageCounter,
      type: name,
      data,
      timestamp: Date.now(),
      sender: buildSender(),
    }

    // Concurrently: a slow broadcast listener must not delay the response of a
    // fast request handler registered under the same name.
    const settled = await Promise.allSettled([...handlers].map((handler) => handler(message)))

    let firstError: unknown
    for (const outcome of settled) {
      if (outcome.status === "fulfilled") {
        if (outcome.value !== undefined) return outcome.value
      } else {
        firstError ??= outcome.reason
      }
    }

    // Every handler either threw or returned undefined. Surface a failure if
    // there was one, mirroring the extension's error propagation.
    if (firstError) throw firstError
    return undefined
  }

  function removeAllListeners() {
    registry.clear()
  }

  return { sendMessage, onMessage, removeAllListeners }
}

/** True when this frame is the page's top-level document. */
export function isTopFrame() {
  return IS_TOP_FRAME
}
