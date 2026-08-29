import { delay } from "@lebedevna/delay";
import { erro, parseJson, safeFetch, validate } from "@lebedevna/neverthrow-utils";
import { rurl } from "@lebedevna/readonly-url";
import { ok, type Result as NeverthrowResult } from "neverthrow";
import {
  ChannelCredentials,
  createChannel,
  createClient as createGrpcClient,
  Metadata,
} from "nice-grpc";
import { z } from "zod";

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
  author?: string;
  text?: string;
  occurredAt?: Date;
}>;

export type YoutubeLiveChatEvent =
  | Readonly<{ type: "state"; state: "connecting" | "live" | "offline" }>
  | Readonly<{ type: "item"; item: YoutubeLiveChatItem }>;

export type YoutubeLiveChatError = Readonly<{
  type: "youtube live chat error";
  operation: "lookup" | "open" | "read" | "close";
  isAbort: boolean;
  cause: unknown;
}>;

type LiveChatLookup =
  | Readonly<{ type: "live"; liveChatId: string }>
  | Readonly<{ type: "offline" }>;

type YoutubeStreamCursor = Readonly<{
  liveChatId: string;
  pageToken?: string;
}>;

type YoutubeStreamState = Readonly<{
  cursor?: YoutubeStreamCursor;
  retryMs: number;
}>;

type YoutubeDependencies = Readonly<{
  lookup(
    videoId: string,
    signal: AbortSignal,
  ): Promise<NeverthrowResult<LiveChatLookup, YoutubeLiveChatError>>;
  open(
    cursor: YoutubeStreamCursor,
    signal: AbortSignal,
  ): ResultStream<LiveChatMessageListResponse, YoutubeLiveChatError>;
  wait(milliseconds: number, signal: AbortSignal): Promise<void>;
}>;

function youtubeError(
  operation: YoutubeLiveChatError["operation"],
  cause: unknown,
  isAbort = false,
) {
  return erro.fmt({ type: "youtube live chat error" as const, operation, isAbort, cause });
}

function defaultDependencies(apiKey: string): YoutubeDependencies {
  return {
    async lookup(videoId, signal) {
      const url = rurl("https://www.googleapis.com/youtube/v3/videos").withSearchParams({
        id: videoId,
        key: apiKey,
        part: "liveStreamingDetails",
      });
      const schema = z.object({
        items: z.array(
          z.object({
            liveStreamingDetails: z
              .object({
                activeLiveChatId: z.string().optional(),
              })
              .optional(),
          }),
        ),
      });
      const $response = await safeFetch(url.href, { signal })
        .andThen(parseJson)
        .andThen((value) => validate(value, schema));
      if ($response.isErr()) {
        const isAbort = $response.error.type === "fetch error" && $response.error.isAbort;
        return erro(youtubeError("lookup", $response.error, isAbort));
      }
      const liveChatId = $response.value.items[0]?.liveStreamingDetails?.activeLiveChatId;
      return ok(liveChatId ? { type: "live", liveChatId } : { type: "offline" });
    },
    async *open(cursor, signal) {
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
              { metadata: Metadata({ "x-goog-api-key": apiKey }), signal },
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
    ...(item.authorDetails?.displayName ? { author: item.authorDetails.displayName } : {}),
    ...(text !== undefined ? { text } : {}),
    ...(!Number.isNaN(occurredAt.getTime()) ? { occurredAt } : {}),
  };
}

function nextState(
  state: YoutubeStreamState,
  response: LiveChatMessageListResponse,
): YoutubeStreamState {
  const receivedText = response.items.some(
    (item) => item.snippet?.type === LiveChatMessageSnippet_TypeWrapper_Type.TEXT_MESSAGE_EVENT,
  );
  return {
    cursor:
      response.offlineAt || !state.cursor
        ? undefined
        : {
            ...state.cursor,
            ...(response.nextPageToken ? { pageToken: response.nextPageToken } : {}),
          },
    retryMs: receivedText ? RETRY_START_MS : state.retryMs,
  };
}

export class YoutubeLiveChatClient {
  readonly stream: (
    videoId: string,
    parentSignal?: AbortSignal,
  ) => ResultStream<YoutubeLiveChatEvent, YoutubeLiveChatError>;

  constructor(options: Readonly<{ apiKey: string }>) {
    const dependencies = defaultDependencies(options.apiKey);
    this.stream = (videoId, parentSignal) =>
      createAbortableStream(async function* (signal) {
        let state: YoutubeStreamState = { retryMs: RETRY_START_MS };
        yield ok({ type: "state", state: "connecting" });

        while (!signal.aborted) {
          const $lookup = await dependencies.lookup(videoId, signal);
          if ($lookup.isErr()) {
            if ($lookup.error.isAbort || signal.aborted) return;
            state = { ...state, cursor: undefined };
            yield propagateError($lookup);
          } else if ($lookup.value.type === "offline") {
            state = { ...state, cursor: undefined };
            yield ok({ type: "state", state: "offline" });
          } else {
            state = {
              ...state,
              cursor:
                state.cursor?.liveChatId === $lookup.value.liveChatId
                  ? state.cursor
                  : { liveChatId: $lookup.value.liveChatId },
            };
            yield ok({ type: "state", state: "live" });
            const cursor = state.cursor;
            if (!cursor) return;

            for await (const $response of dependencies.open(cursor, signal)) {
              if ($response.isErr()) {
                if ($response.error.isAbort || signal.aborted) return;
                yield propagateError($response);
                break;
              }
              state = nextState(state, $response.value);
              for (const item of $response.value.items) {
                yield ok({ type: "item", item: itemFromWire(item) });
              }
              if ($response.value.offlineAt) {
                yield ok({ type: "state", state: "offline" });
                break;
              }
            }
          }

          await dependencies.wait(state.retryMs, signal);
          if (signal.aborted) return;
          state = { ...state, retryMs: Math.min(state.retryMs * 2, RETRY_MAX_MS) };
          yield ok({ type: "state", state: "connecting" });
        }
      }, parentSignal);
  }
}
