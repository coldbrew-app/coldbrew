import type {
  YoutubeLiveChatClient,
  YoutubeLiveChatEvent,
} from "@coldbrew/packages/youtube-live-chat.js";
import { erro } from "@lebedevna/neverthrow-utils";
import { ok, type Result } from "neverthrow";
import { describe, expect, it } from "vitest";

import { createYoutubeChatProvider, youtubeMessageFromItem } from "./youtube.js";

const textItem = {
  kind: "text" as const,
  id: "message-1",
  author: "Viewer",
  text: "Hello",
  occurredAt: new Date("2026-08-27T12:00:00Z"),
};

describe("youtubeMessageFromItem", () => {
  it("maps complete text items and ignores unsupported or malformed items", () => {
    expect(youtubeMessageFromItem(textItem, "video-id")).toEqual({
      id: "message-1",
      provider: "youtube",
      sourceIdentifier: "video-id",
      author: "Viewer",
      text: "Hello",
      occurredAt: new Date("2026-08-27T12:00:00Z"),
    });
    expect(youtubeMessageFromItem({ ...textItem, kind: "other" }, "video-id")).toBeNull();
    expect(youtubeMessageFromItem({ ...textItem, id: undefined }, "video-id")).toBeNull();
  });
});

describe("YouTube chat provider", () => {
  it("maps package events into business chat events", async () => {
    const events: Result<YoutubeLiveChatEvent, never>[] = [
      ok({ type: "state", state: "connecting" }),
      ok({ type: "state", state: "live" }),
      ok({ type: "item", item: { kind: "other" } }),
      ok({ type: "item", item: textItem }),
      ok({ type: "state", state: "offline" }),
    ];
    const client: YoutubeLiveChatClient = {
      async *stream() {
        yield* events;
      },
    };
    const collected = [];
    for await (const event of createYoutubeChatProvider(client).stream("video-id")) {
      collected.push(event);
    }

    expect(collected.map((event) => event._unsafeUnwrap())).toEqual([
      expect.objectContaining({ type: "state", state: "connecting" }),
      expect.objectContaining({ type: "state", state: "live" }),
      expect.objectContaining({
        type: "message",
        message: expect.objectContaining({
          id: textItem.id,
          author: textItem.author,
          text: textItem.text,
          occurredAt: textItem.occurredAt,
        }),
      }),
      expect.objectContaining({ type: "state", state: "offline" }),
    ]);
  });

  it("turns package failures into safe provider errors", async () => {
    const client: YoutubeLiveChatClient = {
      async *stream() {
        yield erro({
          type: "youtube live chat error",
          operation: "read",
          isAbort: false,
          cause: new Error("secret transport detail"),
        });
      },
    };
    const failures = [];
    for await (const failure of createYoutubeChatProvider(client).stream("video-id")) {
      failures.push(failure);
    }
    const [failed] = failures;

    expect(failed?._unsafeUnwrapErr()).toEqual({
      type: "chat provider error",
      provider: "youtube",
      sourceIdentifier: "video-id",
      detail: "YouTube connection failed",
    });
  });
});
