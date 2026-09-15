import { describe, expect, it, vi } from "vitest";

vi.mock("./env.js", () => ({
  env: {
    APP_DOMAIN: "https://streambrew.test",
    BETTER_AUTH_SECRET: "12345678901234567890123456789012",
  },
}));

import {
  clearStreamElementsOAuthAttempt,
  createStreamElementsOAuthAttempt,
  verifyStreamElementsOAuthAttempt,
} from "./streamelements-oauth-state.js";

describe("StreamElements OAuth state", () => {
  it("accepts only the state stored in its signed HttpOnly cookie", () => {
    const attempt = createStreamElementsOAuthAttempt(42);
    const cookieHeader = attempt.cookie.split(";", 1)[0] ?? "";
    const request = new Request("https://streambrew.test/callback", {
      headers: { cookie: cookieHeader },
    });

    expect(attempt.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(attempt.cookie).toContain("streambrew-streamelements-oauth=");
    expect(attempt.cookie).toContain("HttpOnly");
    expect(attempt.cookie).toContain("SameSite=Lax");
    expect(attempt.cookie).toContain("Secure");
    expect(verifyStreamElementsOAuthAttempt(request, attempt.state, 42)).toBe(true);
    expect(verifyStreamElementsOAuthAttempt(request, attempt.state, 7)).toBe(false);
    expect(verifyStreamElementsOAuthAttempt(request, `${attempt.state.slice(0, -1)}x`, 42)).toBe(
      false,
    );
  });

  it("does not accept another provider's OAuth cookie", () => {
    const request = new Request("https://streambrew.test/callback", {
      headers: { cookie: "streambrew-streamlabs-oauth=unrelated" },
    });

    expect(verifyStreamElementsOAuthAttempt(request, "s".repeat(43), 42)).toBe(false);
  });

  it("clears the one-time StreamElements state cookie", () => {
    const cookie = clearStreamElementsOAuthAttempt();

    expect(cookie).toContain("streambrew-streamelements-oauth=");
    expect(cookie).toContain("Max-Age=0");
  });
});
