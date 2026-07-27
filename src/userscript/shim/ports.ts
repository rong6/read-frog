/**
 * Local implementation of `runtime.connect` / `runtime.onConnect`.
 *
 * `src/entrypoints/background/background-stream.ts` (737 lines of streaming
 * protocol) and `src/utils/content-script/port-streaming.ts` both talk over
 * long-lived `runtime.Port`s. Rather than rewrite either side, we hand out a
 * pair of in-memory ports wired back-to-back: what one end posts, the other
 * end receives on the next microtask. Both files then run untouched.
 */

import { EventShim } from "./events"

export interface ShimPort {
  name: string
  sender?: unknown
  postMessage: (message: unknown) => void
  disconnect: () => void
  onMessage: EventShim<[any, ShimPort]>
  onDisconnect: EventShim<[ShimPort]>
  error?: { message: string }
}

export const onConnect = new EventShim<[ShimPort]>("runtime.onConnect")

function createPortPair(name: string, sender: unknown): [ShimPort, ShimPort] {
  let disconnected = false

  const clientMessages = new EventShim<[any, ShimPort]>(`port(${name}).client.onMessage`)
  const serverMessages = new EventShim<[any, ShimPort]>(`port(${name}).server.onMessage`)
  const clientDisconnect = new EventShim<[ShimPort]>(`port(${name}).client.onDisconnect`)
  const serverDisconnect = new EventShim<[ShimPort]>(`port(${name}).server.onDisconnect`)

  const client: ShimPort = {
    name,
    postMessage(message) {
      if (disconnected) throw new Error("Attempting to use a disconnected port object")
      // Async delivery mirrors the real IPC hop and, importantly, keeps the
      // producer from re-entering the consumer synchronously mid-iteration.
      queueMicrotask(() => serverMessages.dispatch(message, server))
    },
    disconnect() {
      if (disconnected) return
      disconnected = true
      queueMicrotask(() => serverDisconnect.dispatch(server))
    },
    onMessage: clientMessages,
    onDisconnect: clientDisconnect,
  }

  const server: ShimPort = {
    name,
    sender,
    postMessage(message) {
      if (disconnected) throw new Error("Attempting to use a disconnected port object")
      queueMicrotask(() => clientMessages.dispatch(message, client))
    },
    disconnect() {
      if (disconnected) return
      disconnected = true
      queueMicrotask(() => clientDisconnect.dispatch(client))
    },
    onMessage: serverMessages,
    onDisconnect: serverDisconnect,
  }

  return [client, server]
}

export function connect(options?: { name?: string }): ShimPort {
  const name = options?.name ?? ""
  const sender = {
    id: "read-frog-userscript",
    url: location.href,
    tab: { id: 0, windowId: 0, url: location.href },
  }
  const [client, server] = createPortPair(name, sender)

  // Give the caller its port object before the "background" side sees the
  // connection, matching the real API's ordering.
  queueMicrotask(() => onConnect.dispatch(server))

  return client
}
