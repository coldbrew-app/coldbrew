import { UserIdSchema } from "@coldbrew/packages/schemas.js";
import { describe, expect, it, vi } from "vitest";

const { disconnect } = vi.hoisted(() => ({ disconnect: vi.fn() }));
vi.mock("../_util.js", () => ({ getUserId: vi.fn() }));
vi.mock("../../donation-integration/client.js", () => ({
  donationIntegration: { disconnect },
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

    expect(disconnect).toHaveBeenCalledWith(42);
  });
});
