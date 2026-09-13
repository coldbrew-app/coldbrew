import { UserIdSchema } from "@coldbrew/packages/schemas.js";
import { describe, expect, it, vi } from "vitest";

const { diagnostic, finished, replay, rotateToken } = vi.hoisted(() => ({
  diagnostic: vi.fn(),
  finished: vi.fn(),
  replay: vi.fn(),
  rotateToken: vi.fn(),
}));

vi.mock("../../donation-alert/client.js", () => ({
  donationAlertService: {
    diagnostic,
    finished,
    replay,
    rotateToken,
  },
  DonationAlertServiceError: class DonationAlertServiceError extends Error {},
}));
vi.mock("../_util.js", () => ({ getViewer: vi.fn() }));
vi.mock("../../env.js", () => ({ env: { APP_DOMAIN: "https://coldbrew.test" } }));

import { alertsRouter } from "./alerts.js";

describe("alerts router", () => {
  it("returns a usable overlay URL without exposing the token as a separate field", async () => {
    rotateToken.mockResolvedValue({ token: "secret-token-abcdefghijklmnopqrstuvwxyz" });
    const caller = alertsRouter.createCaller({
      request: new Request("https://coldbrew.test/api/trpc"),
      userId: UserIdSchema.parse(42),
    });

    await expect(caller.rotateOverlayToken()).resolves.toEqual({
      overlayUrl: "https://coldbrew.test/alerts/overlay#secret-token-abcdefghijklmnopqrstuvwxyz",
    });
    expect(rotateToken).toHaveBeenCalledWith(42, expect.any(AbortSignal));
  });

  it("scopes replay commands to the authenticated streamer", async () => {
    replay.mockResolvedValue(null);
    const caller = alertsRouter.createCaller({
      request: new Request("https://coldbrew.test/api/trpc"),
      userId: UserIdSchema.parse(42),
    });
    const playbackId = "64fb569a-95bb-4d1a-a6ad-765b0f2d5702";

    await caller.replay({ playbackId });

    expect(replay).toHaveBeenCalledWith(42, playbackId, expect.any(AbortSignal));
  });

  it("forwards the complete active player identity on completion", async () => {
    finished.mockResolvedValue(null);
    const caller = alertsRouter.createCaller({
      request: new Request("https://coldbrew.test/api/trpc"),
      userId: null,
    });
    const token = "secret-token-abcdefghijklmnopqrstuvwxyz";

    await caller.finished({
      token,
      playerId: "6a9cabbb-d675-40f5-a248-c40558f75d58",
      generation: 4,
      playbackId: "64fb569a-95bb-4d1a-a6ad-765b0f2d5702",
      outcome: "completed",
    });

    expect(finished).toHaveBeenCalledWith(
      token,
      "6a9cabbb-d675-40f5-a248-c40558f75d58",
      4,
      "64fb569a-95bb-4d1a-a6ad-765b0f2d5702",
      "completed",
      expect.any(AbortSignal),
    );
  });

  it("forwards only a validated renderer diagnostic code", async () => {
    diagnostic.mockResolvedValue(null);
    const caller = alertsRouter.createCaller({
      request: new Request("https://coldbrew.test/api/trpc"),
      userId: null,
    });
    const input = {
      token: "secret-token-abcdefghijklmnopqrstuvwxyz",
      playerId: "6a9cabbb-d675-40f5-a248-c40558f75d58",
      generation: 4,
      playbackId: "64fb569a-95bb-4d1a-a6ad-765b0f2d5702",
      code: "audio_blocked" as const,
    };

    await caller.diagnostic(input);

    expect(diagnostic).toHaveBeenCalledWith(
      input.token,
      input.playerId,
      input.generation,
      input.playbackId,
      input.code,
      expect.any(AbortSignal),
    );
  });
});
