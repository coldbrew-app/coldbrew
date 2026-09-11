import { UserIdSchema } from "@coldbrew/packages/schemas.js";
import { describe, expect, it, vi } from "vitest";

const { connectDonateStream, disconnect } = vi.hoisted(() => ({
  connectDonateStream: vi.fn(),
  disconnect: vi.fn(),
}));
vi.mock("../_util.js", () => ({ getUserId: vi.fn() }));
vi.mock("../../donation-integration/client.js", () => ({
  donationIntegration: { connectDonateStream, disconnect },
  DonationIntegrationError: class DonationIntegrationError extends Error {},
}));

import { integrationRouter } from "./integration.js";

describe("integrationRouter", () => {
  it("disconnects only the authenticated user's DonationAlerts connection", async () => {
    disconnect.mockResolvedValue(null);
    const caller = integrationRouter.createCaller({
      request: new Request("http://localhost/trpc"),
      userId: UserIdSchema.parse(42),
    });

    await caller.disconnect({ source: "donationalerts" });

    expect(disconnect).toHaveBeenCalledWith(42, "donationalerts");
  });

  it("connects donate.stream only for the authenticated user", async () => {
    connectDonateStream.mockResolvedValue({ connected: true });
    const caller = integrationRouter.createCaller({
      request: new Request("http://localhost/trpc"),
      userId: UserIdSchema.parse(42),
    });

    const widgetUrl = "https://donate.stream/widget-alert?uid=group&token=1234567890abcdef";
    await caller.connectDonateStream({ widgetUrl });

    expect(connectDonateStream).toHaveBeenCalledWith(42, widgetUrl);
  });
});
