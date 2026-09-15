import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./env.js", () => ({
  env: {
    APP_DOMAIN: "https://streambrew.test",
  },
}));

const { authorizationUrl, connect } = vi.hoisted(() => ({
  authorizationUrl: vi.fn(),
  connect: vi.fn(),
}));
vi.mock("./donation-integration/client.js", () => ({
  donationIntegration: { authorizationUrl, connect },
}));

import {
  authorizeStreamElements,
  streamElementsAuthorizationStartURL,
  streamElementsAuthorizationURL,
} from "./streamelements.js";

afterEach(() => vi.clearAllMocks());

describe("StreamElements OAuth", () => {
  it("uses the exact authorization and callback endpoints", async () => {
    authorizationUrl.mockResolvedValue({
      authorizationUrl: "https://streamelements.test/authorize",
    });

    expect(streamElementsAuthorizationStartURL).toBe(
      "https://streambrew.test/api/integration/streamelements/authorize",
    );
    await expect(streamElementsAuthorizationURL("oauth-state")).resolves.toBe(
      "https://streamelements.test/authorize",
    );
    expect(authorizationUrl).toHaveBeenCalledWith(
      "streamelements",
      "https://streambrew.test/api/integration/streamelements/callback",
      "oauth-state",
    );
  });

  it("delegates the authenticated connection with the exact callback URI", async () => {
    connect.mockResolvedValue({ connected: true });

    await expect(authorizeStreamElements(42, "auth-code")).resolves.toBeUndefined();
    expect(connect).toHaveBeenCalledWith(
      "streamelements",
      42,
      "auth-code",
      "https://streambrew.test/api/integration/streamelements/callback",
    );
  });
});
