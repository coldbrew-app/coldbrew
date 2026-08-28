import { describe, expect, it } from "vitest";

import {
  formatVideoTime,
  getRoundedWatchDurationMinutes,
  getVideoTimeParts,
  getWatchDurationSeconds,
  parseVideoTime,
} from "./video-timing.js";

describe("video timing", () => {
  it("rounds a total duration to the nearest minute", () => {
    expect(getRoundedWatchDurationMinutes(0)).toBe(0);
    expect(getRoundedWatchDurationMinutes(29)).toBe(0);
    expect(getRoundedWatchDurationMinutes(30)).toBe(1);
    expect(getRoundedWatchDurationMinutes(89)).toBe(1);
    expect(getRoundedWatchDurationMinutes(90)).toBe(2);
  });

  it("rounds after video durations are summed", () => {
    const durations = [20, 20];

    expect(
      getRoundedWatchDurationMinutes(durations.reduce((total, value) => total + value, 0)),
    ).toBe(1);
    expect(
      durations.reduce((total, value) => total + getRoundedWatchDurationMinutes(value), 0),
    ).toBe(0);
  });

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
    [920, { hours: 0, minutes: 15, seconds: 20 }],
    [4520, { hours: 1, minutes: 15, seconds: 20 }],
  ])("splits %i seconds into time units", (seconds, expected) => {
    expect(getVideoTimeParts(seconds)).toEqual(expected);
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
