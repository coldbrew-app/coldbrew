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

import { authorizeDonationAlerts, donationAlertsAuthorizationURL } from "./donationalerts.js";

afterEach(() => vi.clearAllMocks());

describe("DonationAlerts OAuth", () => {
  it("delegates authorization URL creation to the donation integration", async () => {
    authorizationUrl.mockResolvedValue({ authorizationUrl: "https://donation.test/authorize" });

    await expect(donationAlertsAuthorizationURL()).resolves.toBe("https://donation.test/authorize");
    expect(authorizationUrl).toHaveBeenCalledWith(
      "https://coldbrew.test/api/integration/donationalerts/callback",
    );
  });

  it("delegates the authenticated connection to the donation integration", async () => {
    connect.mockResolvedValue({ connected: true });

    await expect(authorizeDonationAlerts(42, "auth-code")).resolves.toBeUndefined();
    expect(connect).toHaveBeenCalledWith(
      42,
      "auth-code",
      "https://coldbrew.test/api/integration/donationalerts/callback",
    );
  });
});
