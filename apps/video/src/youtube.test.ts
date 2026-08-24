import { afterEach, describe, expect, it, vi } from "vitest";

import { extractYoutubeUrls, getYoutubeTiming, parseYoutubeTimestamp } from "./youtube.js";

afterEach(() => vi.unstubAllGlobals());

describe("findYoutubeUrls", () => {
  it("returns unique YouTube URLs from a donation message", () => {
    const result = extractYoutubeUrls(
      "Play https://youtu.be/dQw4w9WgXcQ! Also www.youtube.com/watch?v=dQw4w9WgXcQ and https://youtu.be/dQw4w9WgXcQ",
    );
    expect(result).toEqual([
      "https://youtu.be/dQw4w9WgXcQ",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    ]);
  });

  it("ignores non-YouTube URLs and empty messages", () => {
    expect(extractYoutubeUrls("https://notyoutube.com/watch?v=123")).toEqual([]);
    expect(extractYoutubeUrls(null)).toEqual([]);
  });

  it("replaces http with https", () => {
    const result = extractYoutubeUrls("http://youtu.be/dQw4w9WgXcQ");
    expect(result).toEqual(["https://youtu.be/dQw4w9WgXcQ"]);
  });
});

describe("YouTube timing", () => {
  it.each([
    ["90", 90],
    ["1m30s", 90],
    ["2h3m4s", 7384],
    ["15s", 15],
  ])("parses %s", (value, expected) => {
    expect(parseYoutubeTimestamp(value)).toBe(expected);
  });

  it.each([null, "", "1:30", "abc", "-1", "1m30"])("rejects %s", (value) => {
    expect(parseYoutubeTimestamp(value)).toBeNull();
  });

  it("uses the exact video length", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"lengthSeconds":"213"}')));

    const $timing = getYoutubeTiming("https://youtu.be/dQw4w9WgXcQ");

    await expect($timing).resolves.toMatchObject({
      value: { startSeconds: 0, endSeconds: 213 },
    });
  });

  it("always starts at zero and uses a valid end parameter", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"lengthSeconds":"213"}')));

    const $timing = getYoutubeTiming("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m15s&end=180");

    await expect($timing).resolves.toMatchObject({
      value: { startSeconds: 0, endSeconds: 180 },
    });
  });

  it.each([
    ["https://youtu.be/dQw4w9WgXcQ?t=300", { startSeconds: 0, endSeconds: 213 }],
    ["https://youtu.be/dQw4w9WgXcQ?t=30&end=20", { startSeconds: 0, endSeconds: 20 }],
    ["https://youtu.be/dQw4w9WgXcQ?start=nope&end=300", { startSeconds: 0, endSeconds: 213 }],
  ])("falls back for invalid bounds in %s", async (url, expected) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"lengthSeconds":"213"}')));

    const $timing = getYoutubeTiming(url);

    await expect($timing).resolves.toMatchObject({ value: expected });
  });
});
