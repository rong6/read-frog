import { AUTH_BASE_PATH } from "@read-frog/definitions"
import { createAuthClient } from "better-auth/client"
import { env } from "@/env"
import { runtimeFetch } from "@/utils/runtime-fetch"

// The auth client for code that runs *inside* the background.
//
// It cannot borrow the UI authClient's trick of proxying through
// `sendMessage("backgroundFetch")`: this client is a caller of the background,
// not a client of it. In the extension a service worker never receives its own
// `runtime.sendMessage`, so the message would reject with "Receiving end does
// not exist"; in the userscript build the in-page shim *would* deliver it, but
// only back into the same module that is already awaiting us.
//
// `runtimeFetch` is what that handler would have called anyway, one hop later:
// the platform `fetch` in the extension (unchanged — the service worker's host
// permissions still apply), `GM_xmlhttpRequest` in the userscript, and the
// bridge relay on the dashboard, where a page-origin `credentials: "include"`
// request to the API fails CORS and takes pending Notebase saves down with it.
// `utils/orpc/background-client.ts`, this module's opposite number for the API
// calls the same processor makes, is wired exactly this way.
export const backgroundAuthClient = createAuthClient({
  baseURL: env.WXT_API_URL,
  basePath: AUTH_BASE_PATH,
  fetchOptions: {
    credentials: "include",
    cache: "no-store",
    customFetchImpl: async (
      input: string | URL | globalThis.Request,
      init?: RequestInit,
    ): Promise<Response> =>
      // Both options are re-applied here rather than trusted to survive the round
      // trip through better-fetch's own option merging — the UI authClient pins
      // `credentials` at its transport for the same reason. Getting either wrong
      // is silent: an anonymous request looks exactly like a signed-out user, and
      // a cached one looks exactly like a stale session.
      runtimeFetch(input, { ...init, credentials: "include", cache: "no-store" }),
  },
})
