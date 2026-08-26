import { describe, expect, it } from "vitest";

import { getSharedVideoTimingParts } from "./shared-video-timing";

describe("getSharedVideoTimingParts", () => {
  it.each([
    [
      { startSeconds: 30, endSeconds: 90, durationSeconds: 120 },
      { startTime: "0:30", endTime: "1:30" },
    ],
    [
      { startSeconds: 30, endSeconds: 120, durationSeconds: 120 },
      { startTime: "0:30", endTime: null },
    ],
    [
      { startSeconds: 0, endSeconds: 90, durationSeconds: 120 },
      { startTime: null, endTime: "1:30" },
    ],
    [
      { startSeconds: 0, endSeconds: 120, durationSeconds: 120 },
      { startTime: null, endTime: null },
    ],
  ])("returns only selected boundaries for %o", (timing, expected) => {
    expect(getSharedVideoTimingParts(timing)).toEqual(expected);
  });
});
