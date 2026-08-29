import { createAbortableStream } from "@coldbrew/packages/create-abortable-stream.js";
import type { ResultStream } from "@coldbrew/packages/result-stream.js";
import type { TwitchChatClient, TwitchChatError } from "@coldbrew/packages/twitch-chat.js";
import { erro } from "@lebedevna/neverthrow-utils";
import type { ChatStreamEvent } from "@web/lib/chat.js";
import { ok } from "neverthrow";

import type { ChatEventSource, ChatProviderError, ChatSourceFactory } from "./provider.js";

function providerError(sourceIdentifier: string, _error: TwitchChatError) {
  return erro({
    type: "chat provider error",
    provider: "twitch",
    sourceIdentifier,
    detail: "Twitch connection failed",
  });
}

export class TwitchChatSource implements ChatEventSource {
  constructor(
    private readonly client: TwitchChatClient,
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
        const event = $event.value;
        if (event.type === "state") {
          yield ok({
            type: "state",
            provider: "twitch",
            sourceIdentifier,
            state: event.state,
            ...(event.reason === "channel_not_found" ? { detail: "Twitch channel not found" } : {}),
          });
          continue;
        }
        yield ok({
          type: "message",
          message: {
            id: event.id,
            provider: "twitch",
            sourceIdentifier,
            author: event.author,
            text: event.text,
            occurredAt: event.occurredAt,
          },
        });
      }
    }, parentSignal);
  }
}

export class TwitchChatSourceFactory implements ChatSourceFactory {
  readonly provider = "twitch";

  constructor(private readonly client: TwitchChatClient) {}

  create(sourceIdentifier: string) {
    return new TwitchChatSource(this.client, sourceIdentifier);
  }
}

// Twitch stays intentionally absent from the active provider registry while
// the YouTube-only multichat path is being verified.
