import { createAbortableStream } from "@coldbrew/packages/create-abortable-stream.js";
import type { ResultStream } from "@coldbrew/packages/result-stream.js";
import {
  YoutubeLiveChatClient,
  type YoutubeLiveChatError,
  type YoutubeLiveChatItem,
} from "@coldbrew/packages/youtube-live-chat.js";
import { erro } from "@lebedevna/neverthrow-utils";
import type { ChatStreamEvent } from "@web/lib/chat.js";
import { ok } from "neverthrow";

import { env } from "../env.js";
import type { ChatEventSource, ChatProviderError, ChatSourceFactory } from "./provider.js";

function providerError(sourceIdentifier: string, error: YoutubeLiveChatError) {
  const detail =
    error.operation === "lookup"
      ? "Could not read the YouTube live stream"
      : "YouTube connection failed";
  return erro({
    type: "chat provider error",
    provider: "youtube",
    sourceIdentifier,
    detail,
  });
}

export function youtubeMessageFromItem(item: YoutubeLiveChatItem, sourceIdentifier: string) {
  if (
    item.kind !== "text" ||
    !item.id ||
    !item.author ||
    item.text === undefined ||
    !item.occurredAt
  ) {
    return null;
  }
  return {
    id: item.id,
    provider: "youtube" as const,
    sourceIdentifier,
    author: item.author,
    text: item.text,
    occurredAt: item.occurredAt,
  };
}

export class YoutubeChatSource implements ChatEventSource {
  constructor(
    private readonly client: YoutubeLiveChatClient,
    private readonly sourceIdentifier: string,
  ) {}

  stream(parentSignal?: AbortSignal): ResultStream<ChatStreamEvent, ChatProviderError> {
    const client = this.client;
    const sourceIdentifier = this.sourceIdentifier;
    return createAbortableStream(async function* (signal) {
      for await (const $event of client.stream(sourceIdentifier, signal)) {
        if ($event.isErr()) {
          yield providerError(sourceIdentifier, $event.error);
          continue;
        }
        if ($event.value.type === "state") {
          yield ok({
            type: "state",
            provider: "youtube",
            sourceIdentifier,
            state: $event.value.state,
          });
          continue;
        }
        const message = youtubeMessageFromItem($event.value.item, sourceIdentifier);
        if (message) yield ok({ type: "message", message });
      }
    }, parentSignal);
  }
}

export class YoutubeChatSourceFactory implements ChatSourceFactory {
  readonly provider = "youtube";

  constructor(private readonly client: YoutubeLiveChatClient) {}

  create(sourceIdentifier: string) {
    return new YoutubeChatSource(this.client, sourceIdentifier);
  }
}

export const youtubeChatSourceFactory = new YoutubeChatSourceFactory(
  new YoutubeLiveChatClient({ apiKey: env.YOUTUBE_API_KEY }),
);
