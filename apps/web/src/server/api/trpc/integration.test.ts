import { UserIdSchema } from "@streambrew/packages/schemas.js";
import { describe, expect, it, vi } from "vitest";

const { connectDonateStream, connectTourniquet, disconnect } = vi.hoisted(() => ({
  connectDonateStream: vi.fn(),
  connectTourniquet: vi.fn(),
  disconnect: vi.fn(),
}));
vi.mock("../_util.js", () => ({ getUserId: vi.fn() }));
vi.mock("../../donation-integration/client.js", () => ({
  donationIntegration: { connectDonateStream, connectTourniquet, disconnect },
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

    expect(disconnect).toHaveBeenCalledWith("donationalerts", 42);
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

  it.each(["streamlabs", "streamelements"] as const)(
    "routes %s disconnects to the authenticated user's connection",
    async (source) => {
      disconnect.mockResolvedValue(null);
      const caller = integrationRouter.createCaller({
        request: new Request("http://localhost/trpc"),
        userId: UserIdSchema.parse(42),
      });

      await caller.disconnect({ source });

      expect(disconnect).toHaveBeenCalledWith(source, 42);
    },
  );

  it("connects Tourniquet only for the authenticated user", async () => {
    connectTourniquet.mockResolvedValue({ connected: true });
    const caller = integrationRouter.createCaller({
      request: new Request("http://localhost/trpc"),
      userId: UserIdSchema.parse(42),
    });

    const widgetUrl = "https://tourniquet.app/widgets/alert/AbCdEf0123456789GhIjKlMn";
    await caller.connectTourniquet({ widgetUrl });

    expect(connectTourniquet).toHaveBeenCalledWith(42, widgetUrl);
  });
});
