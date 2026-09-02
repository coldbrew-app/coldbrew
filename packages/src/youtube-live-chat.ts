import { delay } from "@lebedevna/delay";
import { erro } from "@lebedevna/neverthrow-utils";
import { ok } from "neverthrow";
import {
  ChannelCredentials,
  createChannel,
  createClient as createGrpcClient,
  Metadata,
} from "nice-grpc";
import { ClientError, Status } from "nice-grpc-common";

import { createAbortableStream } from "./create-abortable-stream.js";
import { logger } from "./logger.js";
import { propagateError } from "./neverthrow/propagate-error.js";
import { fromFallibleAsyncIterator, type ResultStream } from "./result-stream.js";
import {
  type LiveChatMessageListResponse,
  LiveChatMessageSnippet_TypeWrapper_Type,
  V3DataLiveChatMessageServiceDefinition,
} from "./youtube-live-chat/generated/stream_list.js";

const RETRY_START_MS = 5_000;
const RETRY_MAX_MS = 60_000;

export type YoutubeLiveChatItem = Readonly<{
  kind: "text" | "other";
  id?: string;
  authorId?: string;
  author?: string;
  text?: string;
  occurredAt?: Date;
}>;

export type YoutubeLiveChatEvent =
  | Readonly<{ type: "state"; state: "connecting" | "live" | "offline" }>
  | Readonly<{ type: "item"; item: YoutubeLiveChatItem }>;

export type YoutubeLiveChatError = Readonly<{
  type: "youtube live chat error";
  operation: "open" | "read" | "close";
  reason: "unauthorized" | "rate_limited" | "offline" | "invalid" | "unavailable";
  isAbort: boolean;
  cause: unknown;
}>;

export type YoutubeLiveChatStreamInput = Readonly<{
  liveChatId: string;
  accessToken: string;
}>;

type YoutubeStreamCursor = Readonly<{
  liveChatId: string;
  pageToken?: string;
}>;

type YoutubeStreamState = Readonly<{
  cursor?: YoutubeStreamCursor;
  retryMs: number;
}>;

type YoutubeDependencies = Readonly<{
  open(
    cursor: YoutubeStreamCursor,
    accessToken: string,
    signal: AbortSignal,
  ): ResultStream<LiveChatMessageListResponse, YoutubeLiveChatError>;
  wait(milliseconds: number, signal: AbortSignal): Promise<void>;
}>;

function youtubeError(
  operation: YoutubeLiveChatError["operation"],
  cause: unknown,
  isAbort = false,
) {
  const reason =
    cause instanceof ClientError
      ? cause.code === Status.PERMISSION_DENIED || cause.code === Status.UNAUTHENTICATED
        ? "unauthorized"
        : cause.code === Status.RESOURCE_EXHAUSTED
          ? "rate_limited"
          : cause.code === Status.FAILED_PRECONDITION || cause.code === Status.NOT_FOUND
            ? "offline"
            : cause.code === Status.INVALID_ARGUMENT
              ? "invalid"
              : "unavailable"
      : "unavailable";
  return erro.fmt({
    type: "youtube live chat error" as const,
    operation,
    reason,
    isAbort: isAbort || (cause instanceof ClientError && cause.code === Status.CANCELLED),
    cause,
  });
}

function defaultDependencies(): YoutubeDependencies {
  return {
    async *open(cursor, accessToken, signal) {
      const stream = fromFallibleAsyncIterator(
        () => {
          const channel = createChannel(
            "youtube.googleapis.com:443",
            ChannelCredentials.createSsl(),
          );
          const client = createGrpcClient(V3DataLiveChatMessageServiceDefinition, channel);
          const iterator = client
            .streamList(
              {
                liveChatId: cursor.liveChatId,
                pageToken: cursor.pageToken,
                part: ["snippet", "authorDetails"],
              },
              { metadata: Metadata({ authorization: `Bearer ${accessToken}` }), signal },
            )
            [Symbol.asyncIterator]();
          return {
            next: () => iterator.next(),
            return: async () => {
              try {
                return iterator.return
                  ? await iterator.return()
                  : { done: true as const, value: undefined };
              } finally {
                channel.close();
              }
            },
          };
        },
        (operation, cause, streamSignal) => youtubeError(operation, cause, streamSignal.aborted),
        (error) => logger.error(error),
        signal,
      );
      for await (const $response of stream) {
        yield $response;
      }
    },
    wait: async (milliseconds, signal) => await delay(milliseconds, { signal }),
  };
}

function itemFromWire(item: LiveChatMessageListResponse["items"][number]): YoutubeLiveChatItem {
  const publishedAt = item.snippet?.publishedAt;
  const occurredAt = new Date(publishedAt ?? "");
  const text = item.snippet?.textMessageDetails?.messageText ?? item.snippet?.displayMessage;
  return {
    kind:
      item.snippet?.type === LiveChatMessageSnippet_TypeWrapper_Type.TEXT_MESSAGE_EVENT
        ? "text"
        : "other",
    ...(item.id ? { id: item.id } : {}),
    ...(item.authorDetails?.channelId ? { authorId: item.authorDetails.channelId } : {}),
    ...(item.authorDetails?.displayName ? { author: item.authorDetails.displayName } : {}),
    ...(text !== undefined ? { text } : {}),
    ...(!Number.isNaN(occurredAt.getTime()) ? { occurredAt } : {}),
  };
}

function nextState(
  state: YoutubeStreamState,
  response: LiveChatMessageListResponse,
): YoutubeStreamState {
  return {
    cursor:
      response.offlineAt || !state.cursor
        ? undefined
        : {
            ...state.cursor,
            ...(response.nextPageToken ? { pageToken: response.nextPageToken } : {}),
          },
    retryMs: RETRY_START_MS,
  };
}

export class YoutubeLiveChatClient {
  readonly stream: (
    input: YoutubeLiveChatStreamInput,
    parentSignal?: AbortSignal,
  ) => ResultStream<YoutubeLiveChatEvent, YoutubeLiveChatError>;

  constructor() {
    const dependencies = defaultDependencies();
    this.stream = (input, parentSignal) =>
      createAbortableStream(async function* (signal) {
        let state: YoutubeStreamState = {
          cursor: { liveChatId: input.liveChatId },
          retryMs: RETRY_START_MS,
        };
        yield ok({ type: "state", state: "connecting" });

        while (!signal.aborted) {
          yield ok({ type: "state", state: "live" });
          const cursor = state.cursor;
          if (!cursor) {
            return;
          }

          for await (const $response of dependencies.open(cursor, input.accessToken, signal)) {
            if ($response.isErr()) {
              if ($response.error.isAbort || signal.aborted) {
                return;
              }
              if ($response.error.reason === "offline") {
                yield ok({ type: "state", state: "offline" });
                return;
              }
              yield propagateError($response);
              if (
                $response.error.reason === "unauthorized" ||
                $response.error.reason === "invalid"
              ) {
                return;
              }
              break;
            }
            state = nextState(state, $response.value);
            for (const item of $response.value.items) {
              yield ok({ type: "item", item: itemFromWire(item) });
            }
            if ($response.value.offlineAt) {
              yield ok({ type: "state", state: "offline" });
              return;
            }
          }

          await dependencies.wait(state.retryMs, signal);
          if (signal.aborted) {
            return;
          }
          state = { ...state, retryMs: Math.min(state.retryMs * 2, RETRY_MAX_MS) };
          yield ok({ type: "state", state: "connecting" });
        }
      }, parentSignal);
  }
}
