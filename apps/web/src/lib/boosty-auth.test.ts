import { describe, expect, it } from "vitest";

import { parseBoostyAuth } from "./boosty-auth";

describe("parseBoostyAuth", () => {
  it("decodes auth and preserves tokens and expiry, ignoring unrelated fields", () => {
    const auth = encodeURIComponent(
      JSON.stringify({
        accessToken: " access+/%token ",
        refreshToken: " refresh-token ",
        expiresAt: 1_800_000_000_000,
        unrelated: true,
      }),
    );
    expect(parseBoostyAuth(` ${auth} `)).toEqual({
      accessToken: "access+/%token",
      refreshToken: "refresh-token",
      expiresAt: 1_800_000_000_000,
    });
  });

  it.each([undefined, null, "1800000000000", -1, 0, 1.5, 8_640_000_000_000_001])(
    "rejects invalid expiry (%#)",
    (expiresAt) => {
      expect(() =>
        parseBoostyAuth(
          JSON.stringify({ accessToken: "token", refreshToken: "refresh", expiresAt }),
        ),
      ).toThrow();
    },
  );

  it.each([
    "%invalid",
    "not json",
    "null",
    "[]",
    "{}",
    JSON.stringify({ accessToken: "token" }),
    JSON.stringify({ accessToken: "token", refreshToken: 123 }),
    JSON.stringify({ accessToken: "token", refreshToken: " " }),
    JSON.stringify({ accessToken: "bad token", refreshToken: "refresh" }),
    JSON.stringify({ accessToken: "a".repeat(8193), refreshToken: "refresh" }),
  ])("rejects malformed or incomplete auth (%#)", (auth) => {
    expect(() => parseBoostyAuth(auth)).toThrow();
  });
});
