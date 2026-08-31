import type { ChatRouter } from "@coldbrew/chat/trpc";
import { createTRPCClient, httpBatchLink, httpSubscriptionLink, splitLink } from "@trpc/client";
import { EventSourcePolyfill } from "event-source-polyfill";
import SuperJSON from "superjson";

export function createChatServiceClient(ticket: string) {
  const authorization = `Bearer ${ticket}`;
  return createTRPCClient<ChatRouter>({
    links: [
      splitLink({
        condition: ({ type }) => type === "subscription",
        true: httpSubscriptionLink({
          EventSource: EventSourcePolyfill,
          eventSourceOptions: { headers: { Authorization: authorization } },
          transformer: SuperJSON,
          url: "/api/chat/trpc",
        }),
        false: httpBatchLink({
          headers: { Authorization: authorization },
          transformer: SuperJSON,
          url: "/api/chat/trpc",
        }),
      }),
    ],
  });
}

export type ChatServiceClient = ReturnType<typeof createChatServiceClient>;
