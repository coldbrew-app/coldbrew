import type { DefaultError, FetchQueryOptions, QueryKey } from "@tanstack/react-query";
import { QueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import superjson from "superjson";

import type { AppRouter } from "../server/api/trpc/index";

const authenticatedFetch = createIsomorphicFn()
  .client((url: RequestInfo | URL, options?: RequestInit) =>
    fetch(url, { ...options, credentials: "include" }),
  )
  .server(async (url: RequestInfo | URL, options?: RequestInit) => {
    const { getRequestHeader, getRequestUrl } = await import("@tanstack/react-start/server");
    const headers = new Headers(options?.headers);
    const cookie = getRequestHeader("cookie");
    if (cookie) headers.set("cookie", cookie);

    return fetch(new URL(url.toString(), getRequestUrl()).href, { ...options, headers });
  });

export function createApi() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: 0,
      },
    },
  });

  const trpcClient = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        fetch: authenticatedFetch,
        url: "/api/trpc",
        transformer: superjson,
      }),
    ],
  });

  const trpc = createTRPCOptionsProxy({
    client: trpcClient,
    queryClient,
  });

  return { queryClient, trpc };
}

export type Api = ReturnType<typeof createApi>;

export function useApi() {
  const { queryClient, trpc } = useRouter().options.context;
  return { queryClient, trpc };
}

export async function preloadRouteQuery<
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(queryClient: QueryClient, options: FetchQueryOptions<TQueryFnData, TError, TData, TQueryKey>) {
  if (import.meta.env.SSR) {
    await queryClient.ensureQueryData(options);
    return;
  }

  void queryClient.prefetchQuery(options);
}
