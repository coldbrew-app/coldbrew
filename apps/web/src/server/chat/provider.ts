import type { ResultStream } from "@coldbrew/packages/result-stream.js";
import type { ChatProvider, ChatStreamEvent } from "@web/lib/chat.js";

export type ChatProviderError = Readonly<{
  type: "chat provider error";
  provider: ChatProvider;
  sourceIdentifier: string;
  detail: string;
}>;

export type ChatProviderAdapter = {
  readonly provider: ChatProvider;
  stream(
    sourceIdentifier: string,
    signal?: AbortSignal,
  ): ResultStream<ChatStreamEvent, ChatProviderError>;
};
