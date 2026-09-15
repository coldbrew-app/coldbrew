import { describe, expect, it } from "vitest";

import { InvalidRestreamTargetError, normalizeRestreamServerUrl } from "./target.js";

describe("normalizeRestreamServerUrl", () => {
  it("canonicalizes a public RTMP endpoint", () => {
    expect(normalizeRestreamServerUrl(" RTMPS://LIVE.Example.com:443/app/ ")).toBe(
      "rtmps://live.example.com:443/app",
    );
  });

  it.each([
    "https://live.example.com/app",
    "rtmp://user:secret@live.example.com/app",
    "rtmp://live.example.com/app?token=secret",
    "rtmp://localhost/app",
    "rtmp://127.0.0.1/app",
    "rtmp://10.0.0.1/app",
    "rtmp://[::1]/app",
  ])("rejects unsafe target %s", (input) => {
    expect(() => normalizeRestreamServerUrl(input)).toThrow(InvalidRestreamTargetError);
  });
});
