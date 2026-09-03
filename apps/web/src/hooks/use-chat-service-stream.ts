import {
  chatMessageKey,
  type ChatConnectionError,
  type ChatMessage,
  type ChatSourceState,
  type ChatStreamEvent,
} from "@coldbrew/packages/chat.js";
import { useApi } from "@web/lib/trpc";
import { useEffect, useReducer } from "react";

type StreamState = Readonly<{
  messages: ChatMessage[];
  statuses: Record<string, ChatSourceState>;
  connectionError: ChatConnectionError | null;
}>;

type StreamAction =
  | Readonly<{ type: "reset" }>
  | Readonly<{ type: "transport failed" }>
  | Readonly<{ type: "message removed"; sourceId: string; messageId: string }>
  | Readonly<{ type: "event"; event: ChatStreamEvent }>;

const initialState: StreamState = { messages: [], statuses: {}, connectionError: null };

function reducer(state: StreamState, action: StreamAction): StreamState {
  if (action.type === "reset") {
    return initialState;
  }
  if (action.type === "transport failed") {
    return {
      ...state,
      connectionError: {
        code: "transport_unavailable",
        detail: "Соединение с сервисом чатов прервано",
      },
    };
  }
  if (action.type === "message removed") {
    return {
      ...state,
      messages: state.messages.filter(
        (message) => !(message.sourceId === action.sourceId && message.id === action.messageId),
      ),
    };
  }
  const event = action.event;
  if (event.type === "connection_error") {
    return { ...state, connectionError: event.error };
  }
  if (event.type === "state") {
    return { ...state, statuses: { ...state.statuses, [event.sourceId]: event.state } };
  }
  if (event.type === "message_deleted") {
    return {
      ...state,
      messages: state.messages.filter(
        (message) => !(message.sourceId === event.sourceId && message.id === event.messageId),
      ),
    };
  }

  const key = chatMessageKey(event.message);
  const messages = state.messages.filter((message) => chatMessageKey(message) !== key);
  const insertion = messages.findIndex(
    (message) => message.occurredAt.getTime() > event.message.occurredAt.getTime(),
  );
  const sorted =
    insertion === -1
      ? [...messages, event.message]
      : [...messages.slice(0, insertion), event.message, ...messages.slice(insertion)];
  return {
    ...state,
    messages: sorted.slice(-500),
    statuses: { ...state.statuses, [event.message.sourceId]: "live" },
  };
}

export function useChatServiceStream(mode: "editor" | "overlay" = "editor", overlayToken?: string) {
  const { trpcClient } = useApi();
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    dispatch({ type: "reset" });
    const observer = {
      onData: (event: ChatStreamEvent) => dispatch({ type: "event", event }),
      onError: () => dispatch({ type: "transport failed" }),
    };
    const subscription = (() => {
      if (mode === "editor") {
        return trpcClient.chat.stream.subscribe(undefined, observer);
      }
      if (overlayToken === undefined) {
        return null;
      }
      return trpcClient.chat.overlayStream.subscribe({ token: overlayToken }, observer);
    })();
    if (subscription === null) {
      return;
    }
    return () => {
      subscription.unsubscribe();
    };
  }, [mode, overlayToken, trpcClient]);

  return {
    ...state,
    removeMessage(sourceId: string, messageId: string) {
      dispatch({ type: "message removed", sourceId, messageId });
    },
  };
}
