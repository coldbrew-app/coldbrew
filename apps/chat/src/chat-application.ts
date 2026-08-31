import type {
  ChatBroadcastResult,
  ChatCommandResult,
  ChatConfig,
  ChatModerationCommand,
  ChatProvider,
  ChatSourceId,
  ChatStreamEvent,
} from "@coldbrew/packages/chat.js";
import { MAX_CHAT_MESSAGE_LENGTH } from "@coldbrew/packages/chat.js";
import { erro } from "@lebedevna/neverthrow-utils";
import { ok, type Result } from "neverthrow";

import type { ChatProviderAdapter, ConnectedChatSource } from "./provider.js";

export type ChatApplicationError = Readonly<{
  type:
    | "chat source not found"
    | "chat source refresh unsupported"
    | "chat command unsupported"
    | "invalid chat message";
  detail: string;
}>;

export type ChatAuditEntry = Readonly<{
  userId: number;
  sourceId: ChatSourceId;
  provider: ChatProvider;
  actionType: ChatModerationCommand["type"] | "send_message";
  status: ChatCommandResult["status"];
  providerMessageId?: string;
  providerUserId?: string;
  durationSeconds?: number;
  reason?: string;
  detail?: string;
}>;

export interface ChatRepository {
  getConfig(userId: number): Promise<ChatConfig>;
  getEnabledSources(userId: number): Promise<readonly ConnectedChatSource[]>;
  getSource(userId: number, sourceId: ChatSourceId): Promise<ConnectedChatSource | null>;
  getProviderBanId(sourceId: ChatSourceId, providerUserId: string): Promise<string | null>;
  saveProviderBanId(
    sourceId: ChatSourceId,
    providerUserId: string,
    providerBanId: string,
  ): Promise<void>;
  deleteProviderBanId(sourceId: ChatSourceId, providerUserId: string): Promise<void>;
  recordAction(entry: ChatAuditEntry): Promise<void>;
}

export interface ChatEventBroker {
  publish(userId: number, event: ChatStreamEvent, idempotencyKey: string): Promise<void>;
  stream(userId: number, signal: AbortSignal): AsyncIterable<ChatStreamEvent>;
}

export interface ChatCollectorControl {
  requestRefresh(sourceId: ChatSourceId): Promise<void>;
}

function auditFields(command: ChatModerationCommand) {
  if (command.type === "delete_message") {
    return { providerMessageId: command.messageId };
  }
  if (command.type === "timeout_user") {
    return {
      providerUserId: command.providerUserId,
      durationSeconds: command.durationSeconds,
      ...(command.reason ? { reason: command.reason } : {}),
    };
  }
  if (command.type === "ban_user") {
    return {
      providerUserId: command.providerUserId,
      ...(command.reason ? { reason: command.reason } : {}),
    };
  }
  return { providerUserId: command.providerUserId };
}

function requiredCapability(command: ChatModerationCommand) {
  return command.type;
}

export class ChatApplication {
  private readonly providers: ReadonlyMap<ChatProvider, ChatProviderAdapter>;

  constructor(
    private readonly repository: ChatRepository,
    private readonly broker: ChatEventBroker,
    providers: readonly ChatProviderAdapter[],
    private readonly collectorControl: ChatCollectorControl,
  ) {
    this.providers = new Map(providers.map((provider) => [provider.provider, provider]));
  }

  config(userId: number) {
    return this.repository.getConfig(userId);
  }

  stream(userId: number, signal: AbortSignal) {
    return this.broker.stream(userId, signal);
  }

  async refreshSource(
    userId: number,
    sourceId: ChatSourceId,
  ): Promise<Result<void, ChatApplicationError>> {
    const connectedSource = await this.repository.getSource(userId, sourceId);
    if (!connectedSource) {
      return erro({ type: "chat source not found", detail: "Chat source not found" });
    }
    if (connectedSource.source.provider !== "youtube") {
      return erro({
        type: "chat source refresh unsupported",
        detail: "Manual stream discovery is only available for YouTube",
      });
    }
    await this.collectorControl.requestRefresh(sourceId);
    return ok(undefined);
  }

  async broadcast(
    userId: number,
    text: string,
    signal: AbortSignal,
  ): Promise<Result<ChatBroadcastResult, ChatApplicationError>> {
    const normalizedText = text.trim();
    if (normalizedText.length === 0 || normalizedText.length > MAX_CHAT_MESSAGE_LENGTH) {
      return erro({
        type: "invalid chat message",
        detail: `A chat message must contain between 1 and ${MAX_CHAT_MESSAGE_LENGTH} characters`,
      });
    }

    const sources = await this.repository.getEnabledSources(userId);
    const results = await Promise.all(
      sources.map(async (connectedSource): Promise<ChatCommandResult> => {
        const source = connectedSource.source;
        const provider = this.providers.get(source.provider);
        if (!provider || !connectedSource.capabilities.includes("send_message")) {
          const result: ChatCommandResult = {
            sourceId: source.sourceId,
            status: "unsupported",
            detail: "This provider connection is read-only",
          };
          await this.repository.recordAction({
            userId,
            sourceId: source.sourceId,
            provider: source.provider,
            actionType: "send_message",
            status: result.status,
            detail: result.detail,
          });
          return result;
        }

        const $sent = await provider.sendMessage(connectedSource, normalizedText, signal);
        const result: ChatCommandResult = $sent.match(
          () => ({ sourceId: source.sourceId, status: "succeeded" }),
          (error) => ({ sourceId: source.sourceId, status: "failed", detail: error.detail }),
        );
        await this.repository.recordAction({
          userId,
          sourceId: source.sourceId,
          provider: source.provider,
          actionType: "send_message",
          status: result.status,
          ...(result.detail ? { detail: result.detail } : {}),
        });
        return result;
      }),
    );

    return ok({ results });
  }

  async moderate(
    userId: number,
    command: ChatModerationCommand,
    signal: AbortSignal,
  ): Promise<Result<ChatCommandResult, ChatApplicationError>> {
    const connectedSource = await this.repository.getSource(userId, command.sourceId);
    if (!connectedSource) {
      return erro({ type: "chat source not found", detail: "Chat source not found" });
    }
    const provider = this.providers.get(connectedSource.source.provider);
    if (!provider || !connectedSource.capabilities.includes(requiredCapability(command))) {
      return erro({
        type: "chat command unsupported",
        detail: "This action is not available for the provider connection",
      });
    }

    const providerBanId =
      command.type === "unban_user"
        ? await this.repository.getProviderBanId(command.sourceId, command.providerUserId)
        : null;
    const $moderated = await provider.moderate(
      connectedSource,
      command,
      providerBanId ? { providerBanId } : {},
      signal,
    );
    const result: ChatCommandResult = $moderated.match(
      () => ({ sourceId: command.sourceId, status: "succeeded" }),
      (error) => ({ sourceId: command.sourceId, status: "failed", detail: error.detail }),
    );
    await this.repository.recordAction({
      userId,
      sourceId: command.sourceId,
      provider: connectedSource.source.provider,
      actionType: command.type,
      status: result.status,
      ...auditFields(command),
      ...(result.detail ? { detail: result.detail } : {}),
    });
    if ($moderated.isOk() && $moderated.value.providerBanId && command.type !== "delete_message") {
      await this.repository.saveProviderBanId(
        command.sourceId,
        command.providerUserId,
        $moderated.value.providerBanId,
      );
    }
    if ($moderated.isOk() && command.type === "unban_user") {
      await this.repository.deleteProviderBanId(command.sourceId, command.providerUserId);
    }
    if ($moderated.isOk() && command.type === "delete_message") {
      await this.broker.publish(
        userId,
        {
          type: "message_deleted",
          sourceId: command.sourceId,
          messageId: command.messageId,
        },
        `moderation-delete:${command.sourceId}:${command.messageId}`,
      );
    }

    return ok(result);
  }
}
