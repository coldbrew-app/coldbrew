import { afterEach, describe, expect, it, test, vi } from "vitest";

const library = vi.hoisted(() => ({
  getAuthorizeLink: vi.fn(),
  getDonationsAlerts: vi.fn(),
  getOauthToken: vi.fn(),
  updateOauthToken: vi.fn(),
  WebServer: vi.fn(),
}));

vi.mock("@kash-88/alerts", () => ({
  ...library,
  OAuthScope: {
    UserShow: "oauth-user-show",
    DonationSubscribe: "oauth-donation-subscribe",
    DonationIndex: "oauth-donation-index",
    CustomAlertStore: "oauth-custom_alert-store",
    GoalSubscribe: "oauth-goal-subscribe",
    PollSubscribe: "oauth-poll-subscribe",
  },
}));

import { DonationAlertsFacade, DonationAlertsUnauthorizedError } from "./donationalerts.js";

const facade = new DonationAlertsFacade({ clientId: "1", clientSecret: "secret" });

afterEach(() => vi.clearAllMocks());

describe("DonationAlertsFacade", () => {
  it("delegates OAuth URLs and token exchange to the SDK", async () => {
    library.getAuthorizeLink.mockReturnValue("https://donationalerts.com/oauth/authorize?test");
    library.getOauthToken.mockResolvedValue({
      access_token: "access-token",
      refresh_token: "refresh-token",
    });

    expect(facade.getAuthorizationUrl("https://omnistream.test/callback")).toBe(
      "https://donationalerts.com/oauth/authorize?test",
    );
    expect(library.getAuthorizeLink).toHaveBeenCalledWith(
      "1",
      "https://omnistream.test/callback",
      expect.any(Array),
      "code",
    );

    const $tokens = await facade.issueTokens(
      "authorization-code",
      "https://omnistream.test/callback",
    );
    expect($tokens._unsafeUnwrap()).toEqual({
      accessToken: "access-token",
      refreshToken: "refresh-token",
    });
  });

  it("imports every page through the SDK and converts donations", async () => {
    library.getDonationsAlerts
      .mockResolvedValueOnce({
        data: [
          {
            id: 1,
            username: "Alice",
            message: "Hello",
            amount: 100,
            created_at: "2026-08-14T00:00:00Z",
          },
        ],
        meta: { last_page: 2 },
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: 2,
            username: null,
            message: null,
            amount: 200,
            created_at: "2026-08-14T01:00:00Z",
          },
        ],
        meta: { last_page: 2 },
      });

    const $donations = await facade.getDonations("access-token" as never);

    expect($donations._unsafeUnwrap()).toEqual([
      {
        origin: "donationalerts",
        originDonationId: "1",
        author: "Alice",
        message: "Hello",
        amount: 100,
        createdAt: new Date("2026-08-14T03:00:00Z"),
      },
      {
        origin: "donationalerts",
        originDonationId: "2",
        author: null,
        message: null,
        amount: 200,
        createdAt: new Date("2026-08-14T04:00:00Z"),
      },
    ]);
    expect(library.getDonationsAlerts).toHaveBeenNthCalledWith(1, "access-token", 1);
    expect(library.getDonationsAlerts).toHaveBeenNthCalledWith(2, "access-token", 2);
  });

  it("normalizes SDK unauthorized errors", async () => {
    library.updateOauthToken.mockRejectedValue(new Error("Request failed with status code 401"));

    const $tokens = await facade.refreshTokens("refresh-token" as never);

    expect($tokens._unsafeUnwrapErr()).toBeInstanceOf(DonationAlertsUnauthorizedError);
  });

  it("authorizes WebServer connections and emits only donation events", async () => {
    const client = {
      authorization: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      on: vi.fn(),
    };
    library.WebServer.mockImplementation(function () {
      return client;
    });
    const onDonation = vi.fn();
    const onError = vi.fn();

    const subscription = facade.subscribeToDonations("access-token" as never, {
      onDonation,
      onError,
    });

    const open = client.on.mock.calls.find(([event]) => event === "open")?.[1] as () => void;
    const message = client.on.mock.calls.find(([event]) => event === "message")?.[1] as (
      data: unknown,
    ) => void;
    open();
    await Promise.resolve();
    message({ params: { data: { info: { client: "client-id" } } } });
    message({
      params: {
        data: {
          id: 1,
          username: "Alice",
          message: "Hello",
          amount: 100,
          created_at: "2026-08-14T00:00:00Z",
        },
      },
    });

    expect(client.authorization).toHaveBeenCalledOnce();
    expect(onDonation).toHaveBeenCalledWith({
      origin: "donationalerts",
      originDonationId: "1",
      author: "Alice",
      message: "Hello",
      amount: 100,
      createdAt: new Date("2026-08-14T03:00:00Z"),
    });
    expect(onError).not.toHaveBeenCalled();

    subscription.close();
    expect(client.close).toHaveBeenCalledOnce();
  });
});
