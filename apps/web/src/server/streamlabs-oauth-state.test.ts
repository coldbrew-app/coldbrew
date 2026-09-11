import { describe, expect, it, vi } from "vitest";

vi.mock("./env.js", () => ({
  env: {
    APP_DOMAIN: "https://coldbrew.test",
    BETTER_AUTH_SECRET: "12345678901234567890123456789012",
  },
}));

import {
  clearStreamlabsOAuthAttempt,
  createStreamlabsOAuthAttempt,
  verifyStreamlabsOAuthAttempt,
} from "./streamlabs-oauth-state.js";

describe("Streamlabs OAuth state", () => {
  it("accepts only the state stored in the signed HttpOnly cookie", () => {
    const attempt = createStreamlabsOAuthAttempt(42);
    const cookieHeader = attempt.cookie.split(";", 1)[0] ?? "";
    const request = new Request("https://coldbrew.test/callback", {
      headers: { cookie: cookieHeader },
    });

    expect(attempt.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(attempt.cookie).toContain("HttpOnly");
    expect(attempt.cookie).toContain("SameSite=Lax");
    expect(attempt.cookie).toContain("Secure");
    expect(verifyStreamlabsOAuthAttempt(request, attempt.state, 42)).toBe(true);
    expect(verifyStreamlabsOAuthAttempt(request, attempt.state, 7)).toBe(false);
    expect(verifyStreamlabsOAuthAttempt(request, `${attempt.state.slice(0, -1)}x`, 42)).toBe(false);
  });

  it("clears the one-time state cookie", () => {
    expect(clearStreamlabsOAuthAttempt()).toContain("Max-Age=0");
  });
});
