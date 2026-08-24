import { describe, expect, it } from "vitest";

import { formatVideoTime, getWatchDurationSeconds, parseVideoTime } from "./video-timing.js";

describe("video timing", () => {
  it.each([
    [0, "0:00"],
    [65, "1:05"],
    [3599, "59:59"],
    [3600, "1:00:00"],
    [3723, "1:02:03"],
  ])("formats %i seconds as %s", (seconds, expected) => {
    expect(formatVideoTime(seconds)).toBe(expected);
  });

  it.each([
    ["0:00", 0],
    ["90:05", 5405],
    ["1:02:03", 3723],
    [" 01:05 ", 65],
  ])("parses %s", (value, expected) => {
    expect(parseVideoTime(value)).toBe(expected);
  });

  it.each(["", "10", "1:2", "1:60", "1:2:00", "1:60:00", "1:02:60", "a:10", "-1:00"])(
    "rejects %s",
    (value) => {
      expect(parseVideoTime(value)).toBeNull();
    },
  );

  it("calculates the watched interval without rounding", () => {
    expect(getWatchDurationSeconds(15, 76)).toBe(61);
  });
});
