import { afterEach, describe, expect, it, vi } from "vitest";

import { extractYoutubeUrls, getYoutubeDurationMinutes } from "./youtube.js";

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

  it("gets the duration in minutes from YouTube player metadata", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"lengthSeconds":"213"}')));

    const $duration = getYoutubeDurationMinutes("https://youtu.be/dQw4w9WgXcQ");

    await expect($duration).resolves.toMatchObject({ value: 4 });
  });

  it.each([
    ["keeps the minimum duration at one minute", 15, 1],
    ["rounds the first 15 seconds of a minute down", 75, 1],
    ["rounds up after the 15-second threshold", 76, 2],
  ])("%s", async (_description, seconds, expectedMinutes) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(`{"lengthSeconds":"${seconds}"}`)),
    );

    const $duration = getYoutubeDurationMinutes("https://youtu.be/dQw4w9WgXcQ");

    await expect($duration).resolves.toMatchObject({ value: expectedMinutes });
  });
});
