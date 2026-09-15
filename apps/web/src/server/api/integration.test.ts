import { afterEach, describe, expect, it, vi } from "vitest";

const {
  authorizeDonationAlerts,
  authorizeStreamlabs,
  authorizeStreamElements,
  donationAlertsAuthorizationURL,
  getUserId,
  streamlabsAuthorizationURL,
  streamElementsAuthorizationURL,
  verifyStreamlabsOAuthAttempt,
  verifyStreamElementsOAuthAttempt,
} = vi.hoisted(() => ({
  authorizeDonationAlerts: vi.fn(),
  authorizeStreamlabs: vi.fn(),
  authorizeStreamElements: vi.fn(),
  donationAlertsAuthorizationURL: vi.fn(),
  getUserId: vi.fn(),
  streamlabsAuthorizationURL: vi.fn(),
  streamElementsAuthorizationURL: vi.fn(),
  verifyStreamlabsOAuthAttempt: vi.fn(),
  verifyStreamElementsOAuthAttempt: vi.fn(),
}));

vi.mock("@streambrew/packages/server-logger.js", () => ({ logError: vi.fn() }));
vi.mock("../env.js", () => ({ env: { APP_DOMAIN: "https://streambrew.test" } }));
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
vi.mock("../streamelements.js", () => ({
  authorizeStreamElements,
  streamElementsAuthorizationURL,
}));
vi.mock("../streamelements-oauth-state.js", () => ({
  clearStreamElementsOAuthAttempt: () => "streamelements-oauth=; Max-Age=0",
  createStreamElementsOAuthAttempt: (_userId: number) => ({
    cookie: "streamelements-oauth=signed",
    state: "e".repeat(43),
  }),
  verifyStreamElementsOAuthAttempt,
}));
vi.mock("./_util.js", () => ({ getUserId }));

import {
  handleStreamElementsAuthorize,
  handleStreamElementsCallback,
  handleStreamlabsAuthorize,
  handleStreamlabsCallback,
} from "./integration.js";

afterEach(() => vi.resetAllMocks());

describe("Streamlabs OAuth handlers", () => {
  it("creates a state cookie before redirecting to Streamlabs", async () => {
    getUserId.mockResolvedValue(42);
    streamlabsAuthorizationURL.mockResolvedValue("https://streamlabs.test/authorize");

    const response = await handleStreamlabsAuthorize(
      new Request("https://streambrew.test/api/integration/streamlabs/authorize"),
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
        `https://streambrew.test/api/integration/streamlabs/callback?code=code&state=${"s".repeat(43)}`,
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
        `https://streambrew.test/api/integration/streamlabs/callback?code=code&state=${"s".repeat(43)}`,
      ),
    );

    expect(authorizeStreamlabs).toHaveBeenCalledWith(42, "code");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://streambrew.test/integrations?source=streamlabs&success=true",
    );
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});

describe("StreamElements OAuth handlers", () => {
  it("rejects an unauthenticated authorization request before creating a provider URL", async () => {
    getUserId.mockResolvedValue(null);

    const response = await handleStreamElementsAuthorize(
      new Request("https://streambrew.test/api/integration/streamelements/authorize"),
    );

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("");
    expect(streamElementsAuthorizationURL).not.toHaveBeenCalled();
  });

  it("creates a provider-specific state cookie before redirecting", async () => {
    getUserId.mockResolvedValue(42);
    streamElementsAuthorizationURL.mockResolvedValue("https://streamelements.test/authorize");

    const response = await handleStreamElementsAuthorize(
      new Request("https://streambrew.test/api/integration/streamelements/authorize"),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://streamelements.test/authorize");
    expect(response.headers.get("set-cookie")).toBe("streamelements-oauth=signed");
    expect(streamElementsAuthorizationURL).toHaveBeenCalledWith("e".repeat(43));
  });

  it("redirects an authorization URL failure to the localized integration notice", async () => {
    getUserId.mockResolvedValue(42);
    streamElementsAuthorizationURL.mockRejectedValue(new Error("service unavailable"));

    const response = await handleStreamElementsAuthorize(
      new Request("https://streambrew.test/api/integration/streamelements/authorize"),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://streambrew.test/integrations?source=streamelements&success=false",
    );
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("rejects an unauthenticated callback and consumes the state cookie", async () => {
    getUserId.mockResolvedValue(null);
    const response = await handleStreamElementsCallback(
      new Request(
        `https://streambrew.test/api/integration/streamelements/callback?code=code&state=${"e".repeat(43)}`,
      ),
    );

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(verifyStreamElementsOAuthAttempt).not.toHaveBeenCalled();
    expect(authorizeStreamElements).not.toHaveBeenCalled();
  });

  it("rejects a callback whose state does not match", async () => {
    verifyStreamElementsOAuthAttempt.mockReturnValue(false);
    getUserId.mockResolvedValue(42);
    const request = new Request(
      `https://streambrew.test/api/integration/streamelements/callback?code=code&state=${"e".repeat(43)}`,
    );
    const response = await handleStreamElementsCallback(request);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://streambrew.test/integrations?source=streamelements&success=false",
    );
    expect(verifyStreamElementsOAuthAttempt).toHaveBeenCalledWith(request, "e".repeat(43), 42);
    expect(authorizeStreamElements).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("rejects malformed state without calling the verifier", async () => {
    getUserId.mockResolvedValue(42);
    const response = await handleStreamElementsCallback(
      new Request(
        "https://streambrew.test/api/integration/streamelements/callback?code=code&state=short",
      ),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("success=false");
    expect(verifyStreamElementsOAuthAttempt).not.toHaveBeenCalled();
    expect(authorizeStreamElements).not.toHaveBeenCalled();
  });

  it("redirects a callback without an authorization code after verifying state", async () => {
    verifyStreamElementsOAuthAttempt.mockReturnValue(true);
    getUserId.mockResolvedValue(42);
    const response = await handleStreamElementsCallback(
      new Request(
        `https://streambrew.test/api/integration/streamelements/callback?error=access_denied&state=${"e".repeat(43)}`,
      ),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://streambrew.test/integrations?source=streamelements&success=false",
    );
    expect(authorizeStreamElements).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("redirects a connection failure and consumes the state cookie", async () => {
    verifyStreamElementsOAuthAttempt.mockReturnValue(true);
    getUserId.mockResolvedValue(42);
    authorizeStreamElements.mockRejectedValue(new Error("history unavailable"));
    const response = await handleStreamElementsCallback(
      new Request(
        `https://streambrew.test/api/integration/streamelements/callback?code=code&state=${"e".repeat(43)}`,
      ),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://streambrew.test/integrations?source=streamelements&success=false",
    );
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("connects the authenticated account and consumes the state cookie", async () => {
    verifyStreamElementsOAuthAttempt.mockReturnValue(true);
    getUserId.mockResolvedValue(42);
    authorizeStreamElements.mockResolvedValue(undefined);
    const response = await handleStreamElementsCallback(
      new Request(
        `https://streambrew.test/api/integration/streamelements/callback?code=code&state=${"e".repeat(43)}`,
      ),
    );

    expect(authorizeStreamElements).toHaveBeenCalledWith(42, "code");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://streambrew.test/integrations?source=streamelements&success=true",
    );
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
