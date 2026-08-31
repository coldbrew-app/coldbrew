import type {
  ChatCapability,
  ChatModerationCommand,
  ChatProvider,
  ChatSource,
  ChatStreamEvent,
} from "@coldbrew/packages/chat.js";
import type { ResultStream } from "@coldbrew/packages/result-stream.js";
import type { Result } from "neverthrow";

export type ChatProviderCredentials = Readonly<{
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: Date;
  scopes: readonly string[];
  tokenVersion: number;
}>;

export type ConnectedChatSource = Readonly<{
  source: ChatSource;
  capabilities: readonly ChatCapability[];
  credentials: ChatProviderCredentials;
}>;

export type ChatProviderOperationError = Readonly<{
  type:
    | "provider unauthorized"
    | "provider rate limited"
    | "provider unavailable"
    | "provider rejected command";
  detail: string;
  cause?: unknown;
}>;

export type ChatProviderCommandContext = Readonly<{
  providerBanId?: string;
}>;

export type ChatProviderCommandSuccess = Readonly<{
  providerBanId?: string;
}>;

export interface ChatProviderAdapter {
  readonly provider: ChatProvider;
  readonly collection: "pull" | "push";

  stream(
    connectedSource: ConnectedChatSource,
    signal: AbortSignal,
  ): ResultStream<ChatStreamEvent, ChatProviderOperationError>;

  sendMessage(
    connectedSource: ConnectedChatSource,
    text: string,
    signal: AbortSignal,
  ): Promise<Result<void, ChatProviderOperationError>>;

  moderate(
    connectedSource: ConnectedChatSource,
    command: ChatModerationCommand,
    context: ChatProviderCommandContext,
    signal: AbortSignal,
  ): Promise<Result<ChatProviderCommandSuccess, ChatProviderOperationError>>;
}
