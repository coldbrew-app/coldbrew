import { describe, expect, it } from "vitest";

import {
  MoneyAmountSchema,
  PublicQueueSettingsSchema,
  SharedVideoSchema,
  VideoSchema,
} from "./schemas.js";

describe("MoneyAmountSchema", () => {
  it.each([
    [12.34, "12.34"],
    [0.1, "0.10"],
    [12, "12.00"],
  ])("parses a database JSON number %s", (value, expected) => {
    expect(MoneyAmountSchema.parse(value)).toBe(expected);
  });

  it("rejects an unsafe JavaScript number", () => {
    expect(MoneyAmountSchema.safeParse(Number.MAX_SAFE_INTEGER + 1).success).toBe(false);
  });
});

const baseVideo = {
  videoId: "1",
  videoPriorityId: 1,
  provider: "youtube",
  providerVideoId: "dQw4w9WgXcQ",
  url: "https://youtu.be/dQw4w9WgXcQ",
  queueAmount: "10.00",
  queueCurrency: "RUB",
  startSeconds: 0,
  endSeconds: 213,
  priorityLabel: "queue 0",
  watchedAt: null,
  bookmarkedAt: null,
  createdAt: "2026-08-24T12:00:00.000Z",
};

const donation = {
  donationId: "1",
  source: "donationalerts",
  sourceDonationId: "source-1",
  userId: 1,
  author: "Viewer",
  message: "Play this",
  amount: "10.00",
  currency: "RUB",
  sourceCreatedAt: "source-date",
  occurredAt: "2026-08-24T12:00:00.000Z",
};

describe("VideoSchema", () => {
  it("parses a video from a donation", () => {
    const video = VideoSchema.parse({ ...baseVideo, source: "donation", donation });

    expect(video.source).toBe("donation");
    if (video.source !== "donation") {
      throw new Error("expected a donation video");
    }
    expect(video.donation.author).toBe("Viewer");
  });

  it("parses a manually added video without a donation", () => {
    const video = VideoSchema.parse({ ...baseVideo, source: "manual", donation: null });

    expect(video.source).toBe("manual");
    expect(video.donation).toBeNull();
  });

  it("rejects a source and donation mismatch", () => {
    const result = VideoSchema.safeParse({ ...baseVideo, source: "manual", donation });

    expect(result.success).toBe(false);
  });
});

describe("PublicQueueSettingsSchema", () => {
  it("parses the complete public queue visibility settings", () => {
    expect(
      PublicQueueSettingsSchema.parse({
        enabled: true,
        showAmounts: false,
        showWatchedVideos: true,
      }),
    ).toEqual({ enabled: true, showAmounts: false, showWatchedVideos: true });
  });
});

describe("SharedVideoSchema", () => {
  it("keeps only fields intended for the public queue", () => {
    const video = SharedVideoSchema.parse({
      videoId: "1",
      videoPriorityId: 1,
      provider: "youtube",
      url: "https://youtu.be/dQw4w9WgXcQ",
      startSeconds: 0,
      endSeconds: 213,
      durationSeconds: 213,
      priorityLabel: "queue 0",
      watchedAt: null,
      createdAt: "2026-08-24T12:00:00.000Z",
      displayAmount: null,
      displayCurrency: null,
      bookmarkedAt: "2026-08-24T12:00:00.000Z",
      donation,
    });

    expect(video).not.toHaveProperty("bookmarkedAt");
    expect(video).not.toHaveProperty("donation");
  });

  it("requires display amount and currency together", () => {
    const result = SharedVideoSchema.safeParse({
      videoId: "1",
      videoPriorityId: null,
      provider: "youtube",
      url: "https://youtu.be/dQw4w9WgXcQ",
      startSeconds: 0,
      endSeconds: 213,
      durationSeconds: 213,
      priorityLabel: null,
      watchedAt: null,
      createdAt: "2026-08-24T12:00:00.000Z",
      displayAmount: "10.00",
      displayCurrency: null,
    });

    expect(result.success).toBe(false);
  });
});
