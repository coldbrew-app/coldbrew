import { rurl } from "@lebedevna/readonly-url";
import type { DefaultError, FetchQueryOptions, QueryKey } from "@tanstack/react-query";
import { QueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";
import {
  createTRPCClient,
  httpBatchLink,
  httpSubscriptionLink,
  splitLink,
  type HTTPBatchLinkOptions,
} from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import superjson from "superjson";

import type { AppRouter } from "../server/api/trpc/index";

type AppRouterTypes = AppRouter["_def"]["_config"]["$types"];
type TrpcFetch = NonNullable<HTTPBatchLinkOptions<AppRouterTypes>["fetch"]>;
type TrpcFetchInput = Parameters<TrpcFetch>[0];
type TrpcFetchOptions = Parameters<TrpcFetch>[1];

function fetchInputUrl(input: TrpcFetchInput) {
  if (typeof input === "string") {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}

function toRequestInit(options: TrpcFetchOptions, headers?: Headers): RequestInit {
  return {
    ...options,
    credentials: "include",
    headers: headers ?? options?.headers,
  };
}

const authenticatedFetch = createIsomorphicFn()
  .client((url: TrpcFetchInput, options?: TrpcFetchOptions) => fetch(url, toRequestInit(options)))
  .server(async (url: TrpcFetchInput, options?: TrpcFetchOptions) => {
    const { getRequestHeader, getRequestUrl } = await import("@tanstack/react-start/server");
    const headers = new Headers(options?.headers);
    const cookie = getRequestHeader("cookie");
    if (cookie) {
      headers.set("cookie", cookie);
    }

    return fetch(rurl(fetchInputUrl(url), getRequestUrl()).href, toRequestInit(options, headers));
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
      splitLink({
        condition: (operation) => operation.type === "subscription",
        true: httpSubscriptionLink({
          url: "/api/trpc",
          transformer: superjson,
        }),
        false: httpBatchLink({
          fetch: authenticatedFetch,
          url: "/api/trpc",
          transformer: superjson,
        }),
      }),
    ],
  });

  const trpc = createTRPCOptionsProxy({
    client: trpcClient,
    queryClient,
  });

  return { queryClient, trpc, trpcClient };
}

export type Api = ReturnType<typeof createApi>;

export function useApi() {
  const { queryClient, trpc, trpcClient } = useRouter().options.context;
  return { queryClient, trpc, trpcClient };
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
