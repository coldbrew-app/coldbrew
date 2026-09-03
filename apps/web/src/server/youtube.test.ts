import { afterEach, describe, expect, it, vi } from "vitest";

import { getYoutubeTiming } from "./youtube.js";

const youtube = vi.hoisted(() => ({
  getBasicInfo: vi.fn(),
}));

vi.mock("youtubei.js", () => ({
  Innertube: {
    create: vi.fn(async () => ({ getBasicInfo: youtube.getBasicInfo })),
  },
}));

afterEach(() => vi.clearAllMocks());

describe("getYoutubeTiming", () => {
  it("reads and validates timing through youtubei.js", async () => {
    youtube.getBasicInfo.mockResolvedValue({ basic_info: { duration: 120 } });

    await expect(
      getYoutubeTiming("https://www.youtube.com/watch?v=video", {
        startSeconds: 10,
        endSeconds: 70,
      }),
    ).resolves.toEqual({ startSeconds: 10, endSeconds: 70, durationSeconds: 120 });
    expect(youtube.getBasicInfo).toHaveBeenCalledWith("video");
  });

  it("throws a typed error for invalid timing", async () => {
    youtube.getBasicInfo.mockResolvedValue({ basic_info: { duration: 120 } });

    await expect(
      getYoutubeTiming("https://youtu.be/video", { startSeconds: 100, endSeconds: 130 }),
    ).rejects.toMatchObject({
      name: "YoutubeTimingError",
      type: "youtube: invalid timing",
    });
  });

  it("uses an end timestamp from the URL", async () => {
    youtube.getBasicInfo.mockResolvedValue({ basic_info: { duration: 90 } });

    await expect(getYoutubeTiming("https://youtu.be/video?end=1m")).resolves.toEqual({
      startSeconds: 0,
      endSeconds: 60,
      durationSeconds: 90,
    });
  });

  it("rejects a response without a duration", async () => {
    youtube.getBasicInfo.mockResolvedValue({ basic_info: {} });

    await expect(getYoutubeTiming("https://youtu.be/video")).rejects.toMatchObject({
      type: "youtube: duration not found",
    });
  });

  it("preserves a failed youtubei.js request as the cause", async () => {
    const cause = new Error("unavailable");
    youtube.getBasicInfo.mockRejectedValue(cause);

    await expect(getYoutubeTiming("https://youtu.be/video")).rejects.toMatchObject({
      type: "youtube: request failed",
      cause,
    });
  });
});
