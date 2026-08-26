import {
  extractYoutubeUrls,
  getYoutubeTiming,
  parseYoutubeTimestamp,
  youtubeVideoId,
} from "@coldbrew/packages/youtube.js";
import { afterEach, describe, expect, it, vi } from "vitest";

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

describe("youtubeVideoId", () => {
  it("extracts IDs from supported YouTube URLs", () => {
    expect(youtubeVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("rejects invalid and non-YouTube URLs", () => {
    expect(youtubeVideoId("not a url")).toBeNull();
    expect(youtubeVideoId("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
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
      value: { startSeconds: 0, endSeconds: 213, durationSeconds: 213 },
    });
  });

  it("falls back to the stream duration when video details are omitted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response('{"approxDurationMs":"7260183"}')),
    );

    const $timing = getYoutubeTiming("https://www.youtube.com/watch?v=_JXL6Fn99l8&t=13s");

    await expect($timing).resolves.toMatchObject({
      value: { startSeconds: 0, endSeconds: 7260, durationSeconds: 7260 },
    });
  });

  it("falls back to player metadata when the page omits all duration fields", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"INNERTUBE_CLIENT_VERSION":"2.20260824.01.00"}'))
      .mockResolvedValueOnce(new Response('{"videoDetails":{"lengthSeconds":"7260"}}'));
    vi.stubGlobal("fetch", fetchMock);

    const $timing = getYoutubeTiming("https://www.youtube.com/watch?v=_JXL6Fn99l8&t=13s");

    await expect($timing).resolves.toMatchObject({
      value: { startSeconds: 0, endSeconds: 7260, durationSeconds: 7260 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("always starts at zero and uses a valid end parameter", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"lengthSeconds":"213"}')));

    const $timing = getYoutubeTiming("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m15s&end=180");

    await expect($timing).resolves.toMatchObject({
      value: { startSeconds: 0, endSeconds: 180, durationSeconds: 213 },
    });
  });

  it("uses an explicitly requested range instead of URL timestamps", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"lengthSeconds":"213"}')));

    const $timing = getYoutubeTiming("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=15s&end=180", {
      startSeconds: 30,
      endSeconds: 90,
    });

    await expect($timing).resolves.toMatchObject({
      value: { startSeconds: 30, endSeconds: 90, durationSeconds: 213 },
    });
  });

  it("uses the video length when the requested end is omitted", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"lengthSeconds":"213"}')));

    const $timing = getYoutubeTiming("https://youtu.be/dQw4w9WgXcQ?end=180", {
      startSeconds: 30,
      endSeconds: null,
    });

    await expect($timing).resolves.toMatchObject({
      value: { startSeconds: 30, endSeconds: 213, durationSeconds: 213 },
    });
  });

  it.each([
    { startSeconds: 213, endSeconds: null },
    { startSeconds: 30, endSeconds: 30 },
    { startSeconds: 30, endSeconds: 214 },
  ])("rejects an invalid requested range: %o", async (requestedTiming) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"lengthSeconds":"213"}')));

    const $timing = getYoutubeTiming("https://youtu.be/dQw4w9WgXcQ", requestedTiming);

    await expect($timing).resolves.toMatchObject({
      error: { type: "youtube: invalid timing" },
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

  it("rejects unsupported URLs without fetching them", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const $timing = getYoutubeTiming("https://example.com/watch?v=dQw4w9WgXcQ");

    await expect($timing).resolves.toMatchObject({ error: { type: "youtube: invalid url" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
