import { describe, expect, it } from "vitest";

import { parseVideoTiming } from "./video-timing-fields";

describe("parseVideoTiming", () => {
  it("parses a valid watch range", () => {
    expect(
      parseVideoTiming({ startTime: "1:15", endTime: "2:30" }, { allowOpenEnd: false }),
    ).toEqual({ startSeconds: 75, endSeconds: 150 });
  });

  it("allows an open end when adding a manual video", () => {
    expect(parseVideoTiming({ startTime: "0:30", endTime: "" }, { allowOpenEnd: true })).toEqual({
      startSeconds: 30,
      endSeconds: null,
    });
  });

  it("limits the end to the known video duration", () => {
    expect(
      parseVideoTiming(
        { startTime: "1:15", endTime: "2:31" },
        { allowOpenEnd: true, maximumEndSeconds: 150 },
      ),
    ).toBeNull();
    expect(
      parseVideoTiming(
        { startTime: "1:15", endTime: "2:30" },
        { allowOpenEnd: true, maximumEndSeconds: 150 },
      ),
    ).toEqual({ startSeconds: 75, endSeconds: 150 });
  });

  it.each([
    [{ startTime: "invalid", endTime: "2:00" }, false],
    [{ startTime: "1:00", endTime: "" }, false],
    [{ startTime: "1:00", endTime: "1:00" }, false],
    [{ startTime: "2:00", endTime: "1:00" }, false],
    [{ startTime: "1:00", endTime: "invalid" }, true],
  ])("rejects an invalid range", (values, allowOpenEnd) => {
    expect(parseVideoTiming(values, { allowOpenEnd })).toBeNull();
  });
});
