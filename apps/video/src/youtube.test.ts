import { afterEach, describe, expect, it, vi } from "vitest";

import { extractYoutubeUrls, getYoutubeDurationSeconds } from "./youtube.js";

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

  it("gets the duration from YouTube player metadata", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"lengthSeconds":"213"}')));

    const $duration = getYoutubeDurationSeconds("https://youtu.be/dQw4w9WgXcQ");

    await expect($duration).resolves.toMatchObject({ value: 213 });
  });
});
