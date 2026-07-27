import type { ORPCRouterClient } from "@read-frog/api-contract"
import { createORPCClient } from "@orpc/client"
import { RPCLink } from "@orpc/client/fetch"
import { ORPC_PREFIX } from "@read-frog/definitions"
import { env } from "@/env"
import { runtimeFetch } from "@/utils/runtime-fetch"

const link = new RPCLink({
  url: `${env.WXT_API_URL}${ORPC_PREFIX}`,
  headers: {
    "x-orpc-source": "extension",
  },
  fetch: (request, init) => {
    return runtimeFetch(request, {
      ...init,
      credentials: "include",
    })
  },
})

export const backgroundOrpcClient: ORPCRouterClient = createORPCClient(link)
