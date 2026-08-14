import { QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import superjson from "superjson";

import type { AppRouter } from "../server/api/trpc/index";

const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      fetch(url, options) {
        return fetch(url, { ...options, credentials: "include" });
      },
      url: "/api/trpc",
      transformer: superjson,
    }),
  ],
});

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 0,
    },
  },
});

export const trpc = createTRPCOptionsProxy({
  client: trpcClient,
  queryClient,
});
