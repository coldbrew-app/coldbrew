import { describe, expect, it } from "vitest";

import { VideoSchema } from "./schemas.js";

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
  savedAt: null,
  createdAt: "2026-08-24T12:00:00.000Z",
};

const donation = {
  donationId: "1",
  source: "donationalerts",
  sourceDonationId: "source-1",
  userId: 1,
  author: "Viewer",
  message: "Play this",
  money: { amount: "10.00", currency: "RUB" },
  sourceCreatedAt: "source-date",
  occurredAt: "2026-08-24T12:00:00.000Z",
};

describe("VideoSchema", () => {
  it("parses a video from a donation", () => {
    const video = VideoSchema.parse({ ...baseVideo, source: "donation", donation });

    expect(video.source).toBe("donation");
    if (video.source !== "donation") throw new Error("expected a donation video");
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
