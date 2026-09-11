import { afterEach, describe, expect, it, vi } from "vitest";

const {
  authorizeDonationAlerts,
  authorizeStreamlabs,
  donationAlertsAuthorizationURL,
  getUserId,
  streamlabsAuthorizationURL,
  verifyStreamlabsOAuthAttempt,
} = vi.hoisted(() => ({
  authorizeDonationAlerts: vi.fn(),
  authorizeStreamlabs: vi.fn(),
  donationAlertsAuthorizationURL: vi.fn(),
  getUserId: vi.fn(),
  streamlabsAuthorizationURL: vi.fn(),
  verifyStreamlabsOAuthAttempt: vi.fn(),
}));

vi.mock("@coldbrew/packages/server-logger.js", () => ({ logError: vi.fn() }));
vi.mock("../env.js", () => ({ env: { APP_DOMAIN: "https://coldbrew.test" } }));
vi.mock("../donationalerts.js", () => ({
  authorizeDonationAlerts,
  donationAlertsAuthorizationURL,
}));
vi.mock("../streamlabs.js", () => ({ authorizeStreamlabs, streamlabsAuthorizationURL }));
vi.mock("../streamlabs-oauth-state.js", () => ({
  clearStreamlabsOAuthAttempt: () => "oauth=; Max-Age=0",
  createStreamlabsOAuthAttempt: (_userId: number) => ({
    cookie: "oauth=signed",
    state: "s".repeat(43),
  }),
  verifyStreamlabsOAuthAttempt,
}));
vi.mock("./_util.js", () => ({ getUserId }));

import { handleStreamlabsAuthorize, handleStreamlabsCallback } from "./integration.js";

afterEach(() => vi.clearAllMocks());

describe("Streamlabs OAuth handlers", () => {
  it("creates a state cookie before redirecting to Streamlabs", async () => {
    getUserId.mockResolvedValue(42);
    streamlabsAuthorizationURL.mockResolvedValue("https://streamlabs.test/authorize");

    const response = await handleStreamlabsAuthorize(
      new Request("https://coldbrew.test/api/integration/streamlabs/authorize"),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://streamlabs.test/authorize");
    expect(response.headers.get("set-cookie")).toBe("oauth=signed");
    expect(streamlabsAuthorizationURL).toHaveBeenCalledWith("s".repeat(43));
  });

  it("rejects a callback whose state does not match", async () => {
    verifyStreamlabsOAuthAttempt.mockReturnValue(false);
    getUserId.mockResolvedValue(42);
    const response = await handleStreamlabsCallback(
      new Request(
        `https://coldbrew.test/api/integration/streamlabs/callback?code=code&state=${"s".repeat(43)}`,
      ),
    );

    expect(response.status).toBe(400);
    expect(authorizeStreamlabs).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("connects the authenticated account and consumes the state cookie", async () => {
    verifyStreamlabsOAuthAttempt.mockReturnValue(true);
    getUserId.mockResolvedValue(42);
    authorizeStreamlabs.mockResolvedValue(undefined);
    const response = await handleStreamlabsCallback(
      new Request(
        `https://coldbrew.test/api/integration/streamlabs/callback?code=code&state=${"s".repeat(43)}`,
      ),
    );

    expect(authorizeStreamlabs).toHaveBeenCalledWith(42, "code");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://coldbrew.test/integrations?source=streamlabs&success=true",
    );
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
