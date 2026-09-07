import { describe, expect, it } from "vitest";

import { parseBoostyAuth } from "./boosty-auth";

describe("parseBoostyAuth", () => {
  it("decodes auth and extracts both tokens, ignoring unrelated fields", () => {
    const auth = encodeURIComponent(
      JSON.stringify({
        accessToken: " access+/%token ",
        refreshToken: " refresh-token ",
        expiresAt: 123,
      }),
    );
    expect(parseBoostyAuth(` ${auth} `)).toEqual({
      accessToken: "access+/%token",
      refreshToken: "refresh-token",
    });
  });

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
