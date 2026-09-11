import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../env.js", () => ({
  env: {
    DONATIONS_SERVICE_SECRET: "test-donations-service-secret-32-characters",
    DONATIONS_SERVICE_URL: "http://donations.test",
  },
}));

import { donationIntegration, DonationIntegrationError } from "./client.js";

afterEach(() => vi.unstubAllGlobals());

describe("donation integration client", () => {
  it("authenticates connect requests", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ connected: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      donationIntegration.connect(
        42,
        "auth-code",
        "https://coldbrew.test/api/integration/donationalerts/callback",
      ),
    ).resolves.toEqual({ connected: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://donations.test/internal/connect",
      expect.objectContaining({
        headers: {
          Authorization: "Bearer test-donations-service-secret-32-characters",
          "Content-Type": "application/json",
        },
      }),
    );
    const request = fetchMock.mock.calls[0]?.[1];
    const body = request?.body;
    expect(typeof body).toBe("string");
    if (typeof body !== "string") throw new Error("expected a string request body");
    expect(JSON.parse(body)).toEqual({
      authCode: "auth-code",
      redirectUri: "https://coldbrew.test/api/integration/donationalerts/callback",
      source: "donationalerts",
      userId: 42,
      widgetUrl: "",
    });
  });

  it("sends donate.stream widget URLs only to the private donations service", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ connected: true }));
    vi.stubGlobal("fetch", fetchMock);

    const widgetUrl = "https://donate.stream/widget-alert?uid=group&token=1234567890abcdef";
    await expect(donationIntegration.connectDonateStream(42, widgetUrl)).resolves.toEqual({
      connected: true,
    });

    const request = fetchMock.mock.calls[0]?.[1];
    const body = request?.body;
    expect(typeof body).toBe("string");
    if (typeof body !== "string") throw new Error("expected a string request body");
    expect(JSON.parse(body)).toEqual({
      authCode: "",
      redirectUri: "",
      source: "donate_stream",
      userId: 42,
      widgetUrl,
    });
  });

  it("rejects invalid service responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({ connected: false })),
    );

    await expect(
      donationIntegration.connect(42, "code", "https://coldbrew.test/callback"),
    ).rejects.toBeInstanceOf(DonationIntegrationError);
  });
});
