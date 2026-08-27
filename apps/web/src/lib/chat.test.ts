import { describe, expect, it } from "vitest";

import { ChatSourceListSchema, parseChatSource, parseTwitchChatSource } from "./chat";

describe("parseChatSource", () => {
  it("canonicalizes supported YouTube live URLs", () => {
    expect(parseChatSource("https://youtu.be/dQw4w9WgXcQ?t=4")).toEqual({
      provider: "youtube",
      sourceIdentifier: "dQw4w9WgXcQ",
      sourceUrl: "https://youtu.be/dQw4w9WgXcQ",
    });
    expect(parseChatSource("https://www.youtube.com/live/dQw4w9WgXcQ?feature=share")).toEqual({
      provider: "youtube",
      sourceIdentifier: "dQw4w9WgXcQ",
      sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
  });

  it("keeps Twitch canonicalization ready without enabling it", () => {
    expect(parseChatSource("https://www.twitch.tv/Cold_Brew")).toBeNull();
    expect(parseTwitchChatSource("https://www.twitch.tv/Cold_Brew")).toEqual({
      provider: "twitch",
      sourceIdentifier: "cold_brew",
      sourceUrl: "https://www.twitch.tv/cold_brew",
    });
  });

  it("rejects lookalikes and non-channel Twitch pages", () => {
    expect(parseChatSource("https://youtube.com.example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseTwitchChatSource("https://www.twitch.tv/videos/123")).toBeNull();
    expect(parseTwitchChatSource("https://www.twitch.tv/directory")).toBeNull();
    expect(parseTwitchChatSource("https://clips.twitch.tv/example")).toBeNull();
    expect(parseChatSource("javascript:alert(1)")).toBeNull();
  });

  it("validates and canonicalizes an entire source list once", () => {
    expect(ChatSourceListSchema.parse(["https://youtu.be/dQw4w9WgXcQ?t=4"])).toEqual([
      {
        provider: "youtube",
        sourceIdentifier: "dQw4w9WgXcQ",
        sourceUrl: "https://youtu.be/dQw4w9WgXcQ",
      },
    ]);
    expect(
      ChatSourceListSchema.safeParse([
        "https://youtu.be/dQw4w9WgXcQ",
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      ]).success,
    ).toBe(false);
  });
});
