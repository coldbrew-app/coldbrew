import { createAbortableStream } from "@coldbrew/packages/create-abortable-stream.js";
import type { TwitchChatClient, TwitchChatError } from "@coldbrew/packages/twitch-chat.js";
import { erro } from "@lebedevna/neverthrow-utils";
import { ok } from "neverthrow";

import type { ChatProviderAdapter } from "./provider.js";

function providerError(sourceIdentifier: string, _error: TwitchChatError) {
  return erro({
    type: "chat provider error",
    provider: "twitch",
    sourceIdentifier,
    detail: "Twitch connection failed",
  });
}

export function createTwitchChatProvider(client: TwitchChatClient): ChatProviderAdapter {
  return {
    provider: "twitch",
    stream(sourceIdentifier, parentSignal) {
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
              ...(event.reason === "channel_not_found"
                ? { detail: "Twitch channel not found" }
                : {}),
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
    },
  };
}

// Twitch stays intentionally absent from the active provider registry while
// the YouTube-only multichat path is being verified.
