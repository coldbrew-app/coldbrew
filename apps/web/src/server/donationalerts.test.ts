import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./env.js", () => ({
  env: {
    APP_DOMAIN: "https://coldbrew.test",
    DONATION_ALERTS_CLIENT_ID: "1",
    DONATION_ALERTS_CLIENT_SECRET: "client-secret",
  },
}));

import { authorizeDonationAlerts, donationAlertsAuthorizationURL } from "./donationalerts.js";

afterEach(() => vi.unstubAllGlobals());

describe("DonationAlerts OAuth", () => {
  it("builds the authorization URL", () => {
    const url = new URL(donationAlertsAuthorizationURL());

    expect(url.origin + url.pathname).toBe("https://www.donationalerts.com/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "1",
      redirect_uri: "https://coldbrew.test/api/integration/donationalerts/callback",
      response_type: "code",
      scope: "oauth-user-show oauth-donation-subscribe oauth-donation-index",
    });
  });

  it("exchanges the code and loads the account", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ access_token: "access-token", refresh_token: "refresh-token" }),
      )
      .mockResolvedValueOnce(Response.json({ data: { id: 42 } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(authorizeDonationAlerts("auth-code")).resolves.toEqual({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      sourceUserId: "42",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://www.donationalerts.com/api/v1/user/oauth",
      expect.objectContaining({ headers: { Authorization: "Bearer access-token" } }),
    );
  });
});
