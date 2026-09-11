import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./env.js", () => ({
  env: {
    APP_DOMAIN: "https://coldbrew.test",
  },
}));

const { authorizationUrl, connect } = vi.hoisted(() => ({
  authorizationUrl: vi.fn(),
  connect: vi.fn(),
}));
vi.mock("./donation-integration/client.js", () => ({
  donationIntegration: { authorizationUrl, connect },
}));

import { authorizeStreamlabs, streamlabsAuthorizationURL } from "./streamlabs.js";

afterEach(() => vi.clearAllMocks());

describe("Streamlabs OAuth", () => {
  it("passes the callback and state to the donation integration", async () => {
    authorizationUrl.mockResolvedValue({ authorizationUrl: "https://streamlabs.test/authorize" });

    await expect(streamlabsAuthorizationURL("oauth-state")).resolves.toBe(
      "https://streamlabs.test/authorize",
    );
    expect(authorizationUrl).toHaveBeenCalledWith(
      "streamlabs",
      "https://coldbrew.test/api/integration/streamlabs/callback",
      "oauth-state",
    );
  });

  it("delegates the authenticated connection to the donation integration", async () => {
    connect.mockResolvedValue({ connected: true });

    await expect(authorizeStreamlabs(42, "auth-code")).resolves.toBeUndefined();
    expect(connect).toHaveBeenCalledWith(
      "streamlabs",
      42,
      "auth-code",
      "https://coldbrew.test/api/integration/streamlabs/callback",
    );
  });
});
