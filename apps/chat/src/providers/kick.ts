import { createAbortableStream } from "@coldbrew/packages/create-abortable-stream.js";
import { propagateError } from "@coldbrew/packages/neverthrow/propagate-error.js";
import { delay } from "@lebedevna/delay";
import { erro, safeFetch } from "@lebedevna/neverthrow-utils";
import { rurl } from "@lebedevna/readonly-url";
import { ok, type Result } from "neverthrow";

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

function kickUserId(value: string) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? ok(id) : erro(operationError("Invalid Kick user ID"));
}

export class KickChatProvider implements ChatProviderAdapter {
  readonly provider = "kick";
  readonly collection = "push";

  private headers(connectedSource: ConnectedChatSource) {
    const token = connectedSource.credentials.accessToken;
    return token
      ? ok({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" })
      : erro(operationError("Kick authorization is required"));
  }

  stream(connectedSource: ConnectedChatSource, parentSignal: AbortSignal) {
    return createAbortableStream(async function* (signal) {
      yield ok({
        type: "state" as const,
        sourceId: connectedSource.source.sourceId,
        state: "connecting" as const,
        detail: "Waiting for Kick webhook events",
      });
      while (!signal.aborted) await delay(60_000, { signal });
    }, parentSignal);
  }

  async sendMessage(
    connectedSource: ConnectedChatSource,
    text: string,
    signal: AbortSignal,
  ): Promise<Result<void, ChatProviderOperationError>> {
    const $headers = this.headers(connectedSource);
    if ($headers.isErr()) return propagateError($headers);
    const $broadcasterId = kickUserId(connectedSource.source.providerSourceId);
    if ($broadcasterId.isErr()) return propagateError($broadcasterId);
    return await safeFetch("https://api.kick.com/public/v1/chat", {
      method: "POST",
      headers: $headers.value,
      body: JSON.stringify({
        broadcaster_user_id: $broadcasterId.value,
        content: text,
        type: "user",
      }),
      signal,
    })
      .map(() => undefined)
      .mapErr((error) => operationError("Kick rejected the chat message", error));
  }

  async moderate(
    connectedSource: ConnectedChatSource,
    command: Parameters<ChatProviderAdapter["moderate"]>[1],
    _context: ChatProviderCommandContext,
    signal: AbortSignal,
  ): Promise<Result<ChatProviderCommandSuccess, ChatProviderOperationError>> {
    const $headers = this.headers(connectedSource);
    if ($headers.isErr()) return propagateError($headers);
    const $broadcasterId = kickUserId(connectedSource.source.providerSourceId);
    if ($broadcasterId.isErr()) return propagateError($broadcasterId);
    if (command.type === "delete_message") {
      return await safeFetch(
        rurl(`/public/v1/chat/${encodeURIComponent(command.messageId)}`, "https://api.kick.com")
          .href,
        { method: "DELETE", headers: $headers.value, signal },
      )
        .map(() => ({}))
        .mapErr((error) => operationError("Kick rejected the message deletion", error));
    }

    const $userId = kickUserId(command.providerUserId);
    if ($userId.isErr()) return propagateError($userId);
    if (command.type === "unban_user") {
      return await safeFetch("https://api.kick.com/public/v1/moderation/bans", {
        method: "DELETE",
        headers: $headers.value,
        body: JSON.stringify({
          broadcaster_user_id: $broadcasterId.value,
          user_id: $userId.value,
        }),
        signal,
      })
        .map(() => ({}))
        .mapErr((error) => operationError("Kick rejected the unban", error));
    }
    return await safeFetch("https://api.kick.com/public/v1/moderation/bans", {
      method: "POST",
      headers: $headers.value,
      body: JSON.stringify({
        broadcaster_user_id: $broadcasterId.value,
        user_id: $userId.value,
        ...(command.type === "timeout_user"
          ? { duration: Math.ceil(command.durationSeconds / 60) }
          : {}),
        ...(command.reason ? { reason: command.reason } : {}),
      }),
      signal,
    })
      .map(() => ({}))
      .mapErr((error) => operationError("Kick rejected the moderation action", error));
  }
}
