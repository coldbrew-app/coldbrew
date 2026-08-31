import type {
  ChatBroadcastResult,
  ChatModerationCommand,
  ChatProvider,
  ChatSourceId,
} from "@coldbrew/packages/chat.js";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createChatServiceClient, type ChatServiceClient } from "@web/lib/chat-service";
import { useApi } from "@web/lib/trpc";
import { useMemo } from "react";

type ChatServiceMutationCallbacks = Readonly<{
  onBroadcastSuccess: (result: ChatBroadcastResult) => void;
  onMessageDeleted: (sourceId: ChatSourceId, messageId: string) => void;
  onOverlayUrlChanged: (overlayUrl: string) => void;
}>;

function requireChatServiceClient(client: ChatServiceClient | null) {
  if (client === null) throw new Error("Chat service client is required.");
  return client;
}

function useChatServiceClient(ticket?: string) {
  return useMemo(() => (ticket ? createChatServiceClient(ticket) : null), [ticket]);
}

export function useChatServiceQueries() {
  const { trpc } = useApi();
  const ticketQuery = useQuery({
    ...trpc.chat.ticket.queryOptions(),
    refetchInterval: 4 * 60 * 1_000,
    staleTime: 3 * 60 * 1_000,
  });
  const client = useChatServiceClient(ticketQuery.data?.ticket);
  const configQuery = useQuery({
    queryKey: ["chat-service", "config", ticketQuery.data?.ticket],
    queryFn: () => requireChatServiceClient(client).config.query(),
    enabled: client !== null,
    retry: 0,
  });
  const availabilityQuery = useQuery({
    queryKey: ["chat-service", "provider-availability", ticketQuery.data?.ticket],
    queryFn: () => requireChatServiceClient(client).providerAvailability.query(),
    enabled: client !== null,
    retry: 0,
  });

  return { availabilityQuery, client, configQuery, ticketQuery };
}

export function useChatOverlayClient(token: string) {
  const { trpc } = useApi();
  const ticket = useQuery(trpc.chat.overlayTicket.queryOptions({ token })).data?.ticket;
  return useChatServiceClient(ticket);
}

export function useChatServiceMutations(
  client: ChatServiceClient | null,
  callbacks: ChatServiceMutationCallbacks,
) {
  const { queryClient, trpc } = useApi();
  const refreshConfig = () =>
    queryClient.invalidateQueries({ queryKey: ["chat-service", "config"] });

  const startOauth = useMutation({
    mutationFn: async (provider: Extract<ChatProvider, "youtube" | "twitch" | "kick">) =>
      await requireChatServiceClient(client).startOauth.mutate({ provider }),
    onSuccess: ({ authorizationUrl }) => window.location.assign(authorizationUrl),
  });
  const disconnect = useMutation({
    mutationFn: async (connectionId: string) =>
      await requireChatServiceClient(client).disconnect.mutate({ connectionId }),
    onSuccess: refreshConfig,
  });
  const refreshSource = useMutation({
    mutationFn: async (sourceId: ChatSourceId) =>
      await requireChatServiceClient(client).refreshSource.mutate({ sourceId }),
  });
  const broadcast = useMutation({
    mutationFn: async (text: string) =>
      await requireChatServiceClient(client).broadcast.mutate({ text }),
    onSuccess: callbacks.onBroadcastSuccess,
  });
  const moderate = useMutation({
    mutationFn: async (command: ChatModerationCommand) =>
      await requireChatServiceClient(client).moderate.mutate(command),
    onSuccess: (result, command) => {
      if (result.status === "succeeded" && command.type === "delete_message") {
        callbacks.onMessageDeleted(command.sourceId, command.messageId);
      }
    },
  });
  const rotateOverlay = useMutation(
    trpc.chat.rotateOverlayToken.mutationOptions({
      onSuccess: ({ overlayUrl }) => {
        callbacks.onOverlayUrlChanged(overlayUrl);
        void refreshConfig();
      },
    }),
  );

  return { broadcast, disconnect, moderate, refreshSource, rotateOverlay, startOauth };
}
