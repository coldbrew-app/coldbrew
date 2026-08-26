import type { ChatMessage, ChatSourceState, ChatStreamEvent } from "@web/lib/chat";
import { useEffect, useState } from "react";

import { useApi } from "../lib/trpc";

type Statuses = Record<string, ChatSourceState>;

export function useChatStream(mode: "editor" | "overlay", token?: string, revision?: string) {
  const { trpcClient } = useApi();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [statuses, setStatuses] = useState<Statuses>({});
  const [connectionError, setConnectionError] = useState(false);

  useEffect(() => {
    setMessages([]);
    setStatuses({});
    setConnectionError(false);
    const onData = (event: ChatStreamEvent) => {
      if (event.type === "state") {
        setStatuses((current) => ({
          ...current,
          [`${event.provider}:${event.sourceIdentifier}`]: event.state,
        }));
        return;
      }
      setMessages((current) =>
        [...current.filter((message) => message.id !== event.message.id), event.message]
          .sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime())
          .slice(-500),
      );
    };
    const subscription =
      mode === "editor"
        ? trpcClient.chat.editorStream.subscribe(undefined, {
            onData,
            onError: () => setConnectionError(true),
          })
        : trpcClient.chat.overlayStream.subscribe(
            { token: token ?? "" },
            { onData, onError: () => setConnectionError(true) },
          );
    return () => subscription.unsubscribe();
  }, [mode, revision, token, trpcClient]);

  return { connectionError, messages, statuses };
}
