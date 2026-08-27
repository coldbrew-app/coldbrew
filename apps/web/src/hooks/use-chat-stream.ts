import type { ChatStreamEvent } from "@web/lib/chat";
import { initialChatStreamState, reduceChatStreamState } from "@web/lib/chat-state";
import { useEffect, useReducer } from "react";

import { useApi } from "../lib/trpc";

export function useChatStream(mode: "editor" | "overlay", token?: string, revision?: string) {
  const { trpcClient } = useApi();
  const [state, dispatch] = useReducer(reduceChatStreamState, initialChatStreamState);

  useEffect(() => {
    dispatch({ type: "reset" });
    const onData = (event: ChatStreamEvent) => dispatch({ type: "event received", event });
    const onError = () =>
      dispatch({
        type: "connection error",
        error: {
          code: "transport_unavailable",
          detail: "The chat connection was interrupted",
        },
      });
    const subscription =
      mode === "editor"
        ? trpcClient.chat.editorStream.subscribe(undefined, {
            onData,
            onError,
          })
        : trpcClient.chat.overlayStream.subscribe({ token: token ?? "" }, { onData, onError });
    return () => subscription.unsubscribe();
  }, [mode, revision, token, trpcClient]);

  return state;
}
