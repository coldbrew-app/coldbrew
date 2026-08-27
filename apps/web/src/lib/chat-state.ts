import type {
  ChatConnectionError,
  ChatMessage,
  ChatSource,
  ChatSourceInputError,
  ChatSourceState,
  ChatStreamEvent,
} from "./chat.js";
import { addChatSource, chatMessageKey, chatSourceKey } from "./chat.js";

type ChatStreamState = Readonly<{
  messages: ChatMessage[];
  statuses: Record<string, ChatSourceState>;
  connectionError: ChatConnectionError | null;
}>;

type ChatStreamAction =
  | Readonly<{ type: "reset" }>
  | Readonly<{ type: "connection error"; error: ChatConnectionError }>
  | Readonly<{ type: "event received"; event: ChatStreamEvent }>;

export type ChatEditorState = Readonly<{
  sources: readonly ChatSource[];
  input: string;
  inputError: ChatSourceInputError["reason"] | null;
  overlayUrl: string | null;
  copied: boolean;
}>;

type ChatEditorAction =
  | Readonly<{ type: "config loaded"; sources: readonly ChatSource[] }>
  | Readonly<{ type: "input changed"; input: string }>
  | Readonly<{ type: "source added" }>
  | Readonly<{ type: "source removed"; index: number }>
  | Readonly<{ type: "overlay rotated"; overlayUrl: string }>
  | Readonly<{ type: "overlay copied" }>;

export const initialChatStreamState: ChatStreamState = {
  messages: [],
  statuses: {},
  connectionError: null,
};

export const initialChatEditorState: ChatEditorState = {
  sources: [],
  input: "",
  inputError: null,
  overlayUrl: null,
  copied: false,
};

export function reduceChatStreamState(
  state: ChatStreamState,
  action: ChatStreamAction,
): ChatStreamState {
  if (action.type === "reset") return initialChatStreamState;
  if (action.type === "connection error") return { ...state, connectionError: action.error };
  if (action.event.type === "connection_error") {
    return { ...state, connectionError: action.event.error };
  }
  if (action.event.type === "state") {
    return {
      ...state,
      statuses: {
        ...state.statuses,
        [chatSourceKey(action.event)]: action.event.state,
      },
    };
  }

  const receivedMessage = action.event.message;
  const key = chatMessageKey(receivedMessage);
  const messages = state.messages.filter((message) => chatMessageKey(message) !== key);
  const insertionIndex = messages.findIndex(
    (message) => message.occurredAt.getTime() > receivedMessage.occurredAt.getTime(),
  );
  const sortedMessages =
    insertionIndex === -1
      ? [...messages, receivedMessage]
      : [...messages.slice(0, insertionIndex), receivedMessage, ...messages.slice(insertionIndex)];
  return {
    ...state,
    messages: sortedMessages.slice(-500),
  };
}

export function reduceChatEditorState(
  state: ChatEditorState,
  action: ChatEditorAction,
): ChatEditorState {
  if (action.type === "config loaded") return { ...state, sources: action.sources };
  if (action.type === "input changed") return { ...state, input: action.input };
  if (action.type === "source removed") {
    return { ...state, sources: state.sources.filter((_, index) => index !== action.index) };
  }
  if (action.type === "overlay rotated") {
    return { ...state, overlayUrl: action.overlayUrl, copied: false };
  }
  if (action.type === "overlay copied") return { ...state, copied: true };

  const $sources = addChatSource(state.sources, state.input);
  return $sources.isErr()
    ? { ...state, inputError: $sources.error.reason }
    : {
        ...state,
        sources: $sources.value,
        input: "",
        inputError: null,
      };
}
