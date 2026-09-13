import { describe, expect, it } from "vitest";

import {
  ChatActivitySnapshotSchema,
  ChatModerationCommandSchema,
  ChatProviderSchema,
  chatMessageKey,
  chatSourceKey,
} from "./chat.js";

describe("chat domain", () => {
  it("recognizes every supported provider", () => {
    expect(ChatProviderSchema.options).toEqual(["youtube", "twitch", "kick", "boosty", "vk_video"]);
  });

  it("keys messages within their canonical source", () => {
    const sourceId = "019c58be-a09e-7000-8000-000000000001";
    expect(chatSourceKey({ sourceId })).toBe(sourceId);
    expect(chatMessageKey({ sourceId, id: "message-1" })).toBe(`${sourceId}:message-1`);
  });

  it("rejects timeouts longer than two weeks", () => {
    expect(
      ChatModerationCommandSchema.safeParse({
        type: "timeout_user",
        sourceId: "019c58be-a09e-7000-8000-000000000001",
        providerUserId: "viewer-1",
        durationSeconds: 1_209_601,
      }).success,
    ).toBe(false);
  });

  it("normalizes chat activity timestamps at the wire boundary", () => {
    const result = ChatActivitySnapshotSchema.parse({
      trackingSince: "2026-09-01T00:00:00Z",
      multichat: { now: 2, day: 5, week: 12, month: 30 },
      overlay: { now: 1, day: 3, week: 8, month: 20 },
      total: { now: 2, day: 6, week: 14, month: 35 },
    });

    expect(result.trackingSince).toEqual(new Date("2026-09-01T00:00:00Z"));
  });
});
