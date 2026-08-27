import { createAbortableStream } from "@coldbrew/packages/create-abortable-stream.js";
import {
  createYoutubeLiveChatClient,
  type YoutubeLiveChatClient,
  type YoutubeLiveChatError,
  type YoutubeLiveChatItem,
} from "@coldbrew/packages/youtube-live-chat.js";
import { erro } from "@lebedevna/neverthrow-utils";
import { ok } from "neverthrow";

import { env } from "../env.js";
import type { ChatProviderAdapter } from "./provider.js";

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

export function createYoutubeChatProvider(client: YoutubeLiveChatClient): ChatProviderAdapter {
  return {
    provider: "youtube",
    stream(sourceIdentifier, parentSignal) {
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
    },
  };
}

export const youtubeChatProvider = createYoutubeChatProvider(
  createYoutubeLiveChatClient({ apiKey: env.YOUTUBE_API_KEY }),
);
