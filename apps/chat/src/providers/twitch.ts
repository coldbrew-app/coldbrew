import { createAbortableStream } from "@coldbrew/packages/create-abortable-stream.js";
import { propagateError } from "@coldbrew/packages/neverthrow/propagate-error.js";
import { TwitchChatClient } from "@coldbrew/packages/twitch-chat.js";
import { erro, parseJson, safeFetch, validate } from "@lebedevna/neverthrow-utils";
import { rurl } from "@lebedevna/readonly-url";
import { ok, type Result } from "neverthrow";
import { z } from "zod";

import type {
  ChatProviderAdapter,
  ChatProviderCommandContext,
  ChatProviderCommandSuccess,
  ChatProviderOperationError,
  ConnectedChatSource,
} from "../provider.js";

function operationError(detail: string, cause?: unknown): ChatProviderOperationError {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "type" in cause &&
    cause.type === "http error"
  ) {
    if ("status" in cause && cause.status === 401) {
      return { type: "provider unauthorized", detail, cause };
    }
    if ("status" in cause && cause.status === 429) {
      return { type: "provider rate limited", detail, cause };
    }
  }
  return { type: "provider unavailable", detail, ...(cause ? { cause } : {}) };
}

const SendMessageResponseSchema = z.object({
  data: z.array(
    z.object({
      message_id: z.string(),
      is_sent: z.boolean(),
      drop_reason: z
        .object({
          code: z.string(),
          message: z.string(),
        })
        .nullable(),
    }),
  ),
});

export class TwitchChatProvider implements ChatProviderAdapter {
  readonly provider = "twitch";
  readonly collection = "pull";

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  private headers(connectedSource: ConnectedChatSource) {
    const token = connectedSource.credentials.accessToken;
    return token
      ? ok({ Authorization: `Bearer ${token}`, "Client-Id": this.clientId })
      : erro(operationError("Twitch authorization is required"));
  }

  stream(connectedSource: ConnectedChatSource, parentSignal: AbortSignal) {
    const accessToken = connectedSource.credentials.accessToken;
    const refreshToken = connectedSource.credentials.refreshToken;
    const clientId = this.clientId;
    const clientSecret = this.clientSecret;
    return createAbortableStream(async function* (signal) {
      if (!accessToken || !refreshToken) {
        yield erro(operationError("Twitch authorization is required"));
        return;
      }
      const client = new TwitchChatClient({
        accessToken,
        refreshToken,
        botUserId: connectedSource.source.providerSourceId,
        clientId,
        clientSecret,
      });
      for await (const $event of client.stream(connectedSource.source.displayName, signal)) {
        if ($event.isErr()) {
          yield erro(operationError("Twitch chat connection failed", $event.error));
          continue;
        }
        if ($event.value.type === "state") {
          yield ok({
            type: "state" as const,
            sourceId: connectedSource.source.sourceId,
            state: $event.value.state,
            ...($event.value.reason ? { detail: "Twitch channel not found" } : {}),
          });
          continue;
        }
        yield ok({
          type: "message" as const,
          message: {
            id: $event.value.id,
            sourceId: connectedSource.source.sourceId,
            connectionId: connectedSource.source.connectionId,
            provider: "twitch" as const,
            author: {
              id: $event.value.authorId,
              displayName: $event.value.author,
            },
            text: $event.value.text,
            occurredAt: $event.value.occurredAt,
          },
        });
      }
    }, parentSignal);
  }

  async sendMessage(
    connectedSource: ConnectedChatSource,
    text: string,
    signal: AbortSignal,
  ): Promise<Result<void, ChatProviderOperationError>> {
    const $headers = this.headers(connectedSource);
    if ($headers.isErr()) return propagateError($headers);
    const $response = await safeFetch("https://api.twitch.tv/helix/chat/messages", {
      method: "POST",
      headers: { ...$headers.value, "Content-Type": "application/json" },
      body: JSON.stringify({
        broadcaster_id: connectedSource.source.providerSourceId,
        sender_id: connectedSource.source.providerSourceId,
        message: text,
      }),
      signal,
    })
      .andThen(parseJson)
      .andThen((value) => validate(value, SendMessageResponseSchema));
    if ($response.isErr()) {
      return erro(operationError("Twitch rejected the chat message", $response.error));
    }
    const delivery = $response.value.data.at(0);
    if (!delivery?.is_sent) {
      return erro({
        type: "provider rejected command",
        detail: delivery?.drop_reason?.message ?? "Twitch did not deliver the chat message",
      });
    }
    return ok(undefined);
  }

  async moderate(
    connectedSource: ConnectedChatSource,
    command: Parameters<ChatProviderAdapter["moderate"]>[1],
    _context: ChatProviderCommandContext,
    signal: AbortSignal,
  ): Promise<Result<ChatProviderCommandSuccess, ChatProviderOperationError>> {
    const $headers = this.headers(connectedSource);
    if ($headers.isErr()) return propagateError($headers);
    const baseUrl = rurl("https://api.twitch.tv/helix/moderation").withSearchParams({
      broadcaster_id: connectedSource.source.providerSourceId,
      moderator_id: connectedSource.source.providerSourceId,
    });
    if (command.type === "delete_message") {
      return await safeFetch(
        baseUrl
          .withPathname("/helix/moderation/chat")
          .withSearchParam("message_id", command.messageId).href,
        {
          method: "DELETE",
          headers: $headers.value,
          signal,
        },
      )
        .map(() => ({}))
        .mapErr((error) => operationError("Twitch rejected the message deletion", error));
    }
    if (command.type === "unban_user") {
      return await safeFetch(
        baseUrl
          .withPathname("/helix/moderation/bans")
          .withSearchParam("user_id", command.providerUserId).href,
        { method: "DELETE", headers: $headers.value, signal },
      )
        .map(() => ({}))
        .mapErr((error) => operationError("Twitch rejected the unban", error));
    }
    return await safeFetch(baseUrl.withPathname("/helix/moderation/bans").href, {
      method: "POST",
      headers: { ...$headers.value, "Content-Type": "application/json" },
      body: JSON.stringify({
        data: {
          user_id: command.providerUserId,
          ...(command.type === "timeout_user" ? { duration: command.durationSeconds } : {}),
          ...(command.reason ? { reason: command.reason } : {}),
        },
      }),
      signal,
    })
      .map(() => ({}))
      .mapErr((error) => operationError("Twitch rejected the moderation action", error));
  }
}
