import type { TwitchChatClient } from "@coldbrew/packages/twitch-chat.js";
import { erro } from "@lebedevna/neverthrow-utils";
import { ok } from "neverthrow";
import { describe, expect, it } from "vitest";

import { TwitchChatSource } from "./twitch.js";

describe("Twitch chat provider", () => {
  it("maps package events without exposing transport concepts", async () => {
    const client: TwitchChatClient = {
      async *stream() {
        yield ok({ type: "state", channel: "channel-a", state: "live" });
        yield ok({
          type: "message",
          channel: "channel-a",
          id: "message-1",
          author: "Viewer",
          text: "Hello",
          occurredAt: new Date("2026-08-27T12:00:00Z"),
        });
      },
    };
    const events = [];
    for await (const event of new TwitchChatSource(client, "channel-a").stream()) {
      events.push(event._unsafeUnwrap());
    }

    expect(events).toEqual([
      expect.objectContaining({ type: "state", provider: "twitch", state: "live" }),
      {
        type: "message",
        message: {
          id: "message-1",
          provider: "twitch",
          sourceIdentifier: "channel-a",
          author: "Viewer",
          text: "Hello",
          occurredAt: new Date("2026-08-27T12:00:00Z"),
        },
      },
    ]);
  });

  it("maps package failures to safe provider errors", async () => {
    const client: TwitchChatClient = {
      async *stream() {
        yield erro({
          type: "twitch chat error",
          operation: "read",
          channel: "channel-a",
          isAbort: false,
          cause: new Error("secret transport detail"),
        });
      },
    };
    const failures = [];
    for await (const failure of new TwitchChatSource(client, "channel-a").stream()) {
      failures.push(failure);
    }

    expect(failures[0]?._unsafeUnwrapErr()).toMatchObject({
      type: "chat provider error",
      provider: "twitch",
      sourceIdentifier: "channel-a",
      detail: "Twitch connection failed",
    });
  });
});
