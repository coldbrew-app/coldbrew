import type {
  ChatBroadcastResult,
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
    startOauth,
  };
}
