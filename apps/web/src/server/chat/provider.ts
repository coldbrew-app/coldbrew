import type { EventSource, EventSourceFactory } from "@coldbrew/packages/result-stream.js";
import type { ChatProvider, ChatStreamEvent } from "@web/lib/chat.js";

export type ChatProviderError = Readonly<{
  type: "chat provider error";
  provider: ChatProvider;
  sourceIdentifier: string;
  detail: string;
}>;

export type ChatEventSource = EventSource<ChatStreamEvent, ChatProviderError>;

export type ChatSourceFactory = EventSourceFactory<string, ChatStreamEvent, ChatProviderError> & {
  readonly provider: ChatProvider;
};
