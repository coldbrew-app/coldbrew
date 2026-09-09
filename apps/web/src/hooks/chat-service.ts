import type {
  ChatBroadcastResult,
  ChatConfig,
  ChatModerationCommand,
  ChatSourceId,
} from "@coldbrew/packages/chat.js";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useApi } from "@web/lib/trpc";

type ChatServiceMutationCallbacks = Readonly<{
  onBroadcastSuccess: (result: ChatBroadcastResult) => void;
  onMessageDeleted: (sourceId: ChatSourceId, messageId: string) => void;
  onOverlayUrlChanged: (overlayUrl: string) => void;
}>;

export function useChatServiceQueries() {
  const { trpc } = useApi();
  const configQuery = useQuery(trpc.chat.config.queryOptions());
  const availabilityQuery = useQuery(trpc.chat.providerAvailability.queryOptions());

  return { availabilityQuery, configQuery };
}

export function useChatServiceMutations(callbacks: ChatServiceMutationCallbacks) {
  const { queryClient, trpc } = useApi();
  const refreshConfig = () =>
    queryClient.invalidateQueries({ queryKey: trpc.chat.config.queryKey() });

  const startOauth = useMutation(
    trpc.chat.startOauth.mutationOptions({
      onSuccess: ({ authorizationUrl }) => window.location.assign(authorizationUrl),
    }),
  );
  const disconnect = useMutation(
    trpc.chat.disconnect.mutationOptions({ onSuccess: refreshConfig }),
  );
  const refreshSource = useMutation(trpc.chat.refreshSource.mutationOptions());
  const setSourceEnabled = useMutation(
    trpc.chat.setSourceEnabled.mutationOptions({
      onMutate: async ({ enabled, sourceId }) => {
        const queryKey = trpc.chat.config.queryKey();
        await queryClient.cancelQueries({ queryKey });
        const previousConfig = queryClient.getQueryData<ChatConfig>(queryKey);
        queryClient.setQueryData<ChatConfig>(queryKey, (config) =>
          config
            ? {
                ...config,
                sources: config.sources.map((source) =>
                  source.sourceId === sourceId ? { ...source, enabled } : source,
                ),
              }
            : config,
        );
        return { previousConfig };
      },
      onError: (_error, _variables, context) => {
        if (context?.previousConfig) {
          queryClient.setQueryData(trpc.chat.config.queryKey(), context.previousConfig);
        }
      },
      onSettled: refreshConfig,
    }),
  );
  const broadcast = useMutation(
    trpc.chat.broadcast.mutationOptions({ onSuccess: callbacks.onBroadcastSuccess }),
  );
  const moderate = useMutation(
    trpc.chat.moderate.mutationOptions({
      onSuccess: (result, command: ChatModerationCommand) => {
        if (result.status === "succeeded" && command.type === "delete_message") {
          callbacks.onMessageDeleted(command.sourceId, command.messageId);
        }
      },
    }),
  );
  const rotateOverlay = useMutation(
    trpc.chat.rotateOverlayToken.mutationOptions({
      onSuccess: ({ overlayUrl }) => {
        callbacks.onOverlayUrlChanged(overlayUrl);
        void refreshConfig();
      },
    }),
  );

  return {
    broadcast,
    disconnect,
    moderate,
    refreshSource,
    rotateOverlay,
    setSourceEnabled,
    startOauth,
  };
}

export function useBoostyConnection(onConnected: () => void) {
  const { trpc, queryClient } = useApi();
  return useMutation(
    trpc.chat.connectBoosty.mutationOptions({
      gcTime: 0,
      retry: false,
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: trpc.chat.config.queryKey() });
        onConnected();
      },
    }),
  );
}
