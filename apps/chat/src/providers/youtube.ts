import type { ChatStreamEvent } from "@coldbrew/packages/chat.js";
import { createAbortableStream } from "@coldbrew/packages/create-abortable-stream.js";
import { propagateError } from "@coldbrew/packages/neverthrow/propagate-error.js";
import type { ResultStream } from "@coldbrew/packages/result-stream.js";
import { YoutubeLiveChatClient } from "@coldbrew/packages/youtube-live-chat.js";
import { delay } from "@lebedevna/delay";
import { erro, parseJson, safeFetch, validate } from "@lebedevna/neverthrow-utils";
import { rurl } from "@lebedevna/readonly-url";
import { ok, safeTry, type Result } from "neverthrow";
import { z } from "zod";

import type {
  ChatProviderAdapter,
  ChatProviderCommandContext,
  ChatProviderCommandSuccess,
  ChatProviderOperationError,
  ConnectedChatSource,
} from "../provider.js";

const DISCOVERY_RETRY_START_MS = 5_000;
const DISCOVERY_RETRY_MAX_MS = 60_000;

type ActiveBroadcast = Readonly<{
  liveChatId: string;
}>;

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
  if (
    typeof cause === "object" &&
    cause !== null &&
    "type" in cause &&
    cause.type === "youtube live chat error" &&
    "reason" in cause
  ) {
    if (cause.reason === "unauthorized") {
      return { type: "provider unauthorized", detail, cause };
    }
    if (cause.reason === "rate_limited") {
      return { type: "provider rate limited", detail, cause };
    }
    if (cause.reason === "invalid") {
      return { type: "provider rejected command", detail, cause };
    }
  }
  return {
    type: "provider unavailable",
    detail,
    cause,
  };
}

function accessToken(connectedSource: ConnectedChatSource) {
  return connectedSource.credentials.accessToken;
}

function youtubeHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function activeBroadcast(
  connectedSource: ConnectedChatSource,
  signal: AbortSignal,
): Promise<Result<ActiveBroadcast | null, ChatProviderOperationError>> {
  const token = accessToken(connectedSource);
  if (!token) {
    return erro(operationError("YouTube authorization is required"));
  }
  const url = rurl("https://www.googleapis.com/youtube/v3/liveBroadcasts").withSearchParams({
    part: "snippet",
    broadcastStatus: "active",
    broadcastType: "all",
    mine: true,
  });
  const schema = z.object({
    items: z.array(
      z.object({
        snippet: z.object({
          liveChatId: z.string().optional(),
        }),
      }),
    ),
  });
  const $response = await safeFetch(url.href, {
    headers: youtubeHeaders(token),
    signal,
  })
    .andThen(parseJson)
    .andThen((value) => validate(value, schema));
  if ($response.isErr()) {
    return erro(operationError("Could not discover the active YouTube broadcast", $response.error));
  }
  const broadcast = $response.value.items.find((item) => item.snippet.liveChatId);
  return ok(broadcast?.snippet.liveChatId ? { liveChatId: broadcast.snippet.liveChatId } : null);
}

async function waitUntilAborted(signal: AbortSignal) {
  if (signal.aborted) {
    return;
  }
  await new Promise<void>((resolve) =>
    signal.addEventListener("abort", () => resolve(), { once: true }),
  );
}

async function liveChatRequest(
  connectedSource: ConnectedChatSource,
  path: string,
  init: RequestInit,
  signal: AbortSignal,
) {
  const token = accessToken(connectedSource);
  if (!token) {
    return erro(operationError("YouTube authorization is required"));
  }
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(youtubeHeaders(token))) {
    headers.set(name, value);
  }
  return await safeFetch(rurl(path, "https://www.googleapis.com/youtube/v3/").href, {
    ...init,
    headers,
    signal,
  }).mapErr((error) => operationError("YouTube rejected the chat command", error));
}

export class YoutubeChatProvider implements ChatProviderAdapter {
  readonly provider = "youtube";
  readonly collection = "pull";
  private readonly client: YoutubeLiveChatClient;

  constructor() {
    this.client = new YoutubeLiveChatClient();
  }

  stream(
    connectedSource: ConnectedChatSource,
    parentSignal: AbortSignal,
  ): ResultStream<ChatStreamEvent, ChatProviderOperationError> {
    const client = this.client;
    return createAbortableStream(async function* (signal) {
      const token = accessToken(connectedSource);
      if (!token) {
        yield erro(operationError("YouTube authorization is required"));
        return;
      }
      let retryMs = DISCOVERY_RETRY_START_MS;
      yield ok({
        type: "state",
        sourceId: connectedSource.source.sourceId,
        state: "connecting",
      });

      while (!signal.aborted) {
        const $broadcast = await activeBroadcast(connectedSource, signal);
        if ($broadcast.isErr()) {
          yield propagateError($broadcast);
          if ($broadcast.error.type === "provider unauthorized") {
            await waitUntilAborted(signal);
            return;
          }
          await delay(retryMs, { signal });
          retryMs = Math.min(retryMs * 2, DISCOVERY_RETRY_MAX_MS);
          yield ok({
            type: "state",
            sourceId: connectedSource.source.sourceId,
            state: "connecting",
          });
          continue;
        }
        if (!$broadcast.value) {
          yield ok({
            type: "state",
            sourceId: connectedSource.source.sourceId,
            state: "offline",
          });
          await waitUntilAborted(signal);
          return;
        }

        for await (const $event of client.stream(
          { liveChatId: $broadcast.value.liveChatId, accessToken: token },
          signal,
        )) {
          if ($event.isErr()) {
            const error = operationError("YouTube chat connection failed", $event.error);
            yield erro(error);
            if (
              error.type === "provider unauthorized" ||
              error.type === "provider rejected command"
            ) {
              await waitUntilAborted(signal);
              return;
            }
            continue;
          }
          if ($event.value.type === "state") {
            yield ok({
              type: "state",
              sourceId: connectedSource.source.sourceId,
              state: $event.value.state,
            });
            if ($event.value.state === "offline") {
              await waitUntilAborted(signal);
              return;
            }
            continue;
          }
          const item = $event.value.item;
          if (
            item.kind !== "text" ||
            !item.id ||
            !item.authorId ||
            !item.author ||
            item.text === undefined ||
            !item.occurredAt
          ) {
            continue;
          }
          yield ok({
            type: "message",
            message: {
              id: item.id,
              sourceId: connectedSource.source.sourceId,
              connectionId: connectedSource.source.connectionId,
              provider: "youtube",
              author: { id: item.authorId, displayName: item.author },
              text: item.text,
              occurredAt: item.occurredAt,
            },
          });
        }
        return;
      }
    }, parentSignal);
  }

  async sendMessage(
    connectedSource: ConnectedChatSource,
    text: string,
    signal: AbortSignal,
  ): Promise<Result<void, ChatProviderOperationError>> {
    return await safeTry(async function* () {
      const broadcast = yield* await activeBroadcast(connectedSource, signal);
      if (!broadcast) {
        return erro(operationError("The YouTube channel is not live"));
      }
      yield* await liveChatRequest(
        connectedSource,
        rurl("liveChat/messages", "https://www.googleapis.com/youtube/v3/").withSearchParam(
          "part",
          "snippet",
        ).href,
        {
          method: "POST",
          body: JSON.stringify({
            snippet: {
              liveChatId: broadcast.liveChatId,
              type: "textMessageEvent",
              textMessageDetails: { messageText: text },
            },
          }),
        },
        signal,
      );
      return ok(undefined);
    });
  }

  async moderate(
    connectedSource: ConnectedChatSource,
    command: Parameters<ChatProviderAdapter["moderate"]>[1],
    context: ChatProviderCommandContext,
    signal: AbortSignal,
  ): Promise<Result<ChatProviderCommandSuccess, ChatProviderOperationError>> {
    if (command.type === "delete_message") {
      const $response = await liveChatRequest(
        connectedSource,
        rurl("liveChat/messages", "https://www.googleapis.com/youtube/v3/").withSearchParam(
          "id",
          command.messageId,
        ).href,
        { method: "DELETE" },
        signal,
      );
      return $response.map(() => ({}));
    }
    if (command.type === "unban_user") {
      if (!context.providerBanId) {
        return erro({
          type: "provider rejected command",
          detail: "The YouTube ban identifier is no longer available",
        });
      }
      const $response = await liveChatRequest(
        connectedSource,
        rurl("liveChat/bans", "https://www.googleapis.com/youtube/v3/").withSearchParam(
          "id",
          context.providerBanId,
        ).href,
        { method: "DELETE" },
        signal,
      );
      return $response.map(() => ({}));
    }

    return await safeTry(async function* () {
      const broadcast = yield* await activeBroadcast(connectedSource, signal);
      if (!broadcast) {
        return erro(operationError("The YouTube channel is not live"));
      }
      const response = yield* await liveChatRequest(
        connectedSource,
        rurl("liveChat/bans", "https://www.googleapis.com/youtube/v3/").withSearchParam(
          "part",
          "snippet",
        ).href,
        {
          method: "POST",
          body: JSON.stringify({
            snippet: {
              liveChatId: broadcast.liveChatId,
              type: command.type === "timeout_user" ? "temporary" : "permanent",
              ...(command.type === "timeout_user"
                ? { banDurationSeconds: command.durationSeconds }
                : {}),
              bannedUserDetails: { channelId: command.providerUserId },
            },
          }),
        },
        signal,
      );
      const schema = z.object({
        id: z.string(),
      });
      return parseJson(response)
        .andThen((value) => validate(value, schema))
        .map((ban) => ({ providerBanId: ban.id }))
        .mapErr((error) => operationError("YouTube returned an invalid ban", error));
    });
  }
}
