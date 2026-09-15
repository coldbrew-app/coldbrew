import { UserIdSchema } from "@streambrew/packages/schemas.js";
import { TRPCError } from "@trpc/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const { config, createDestination } = vi.hoisted(() => ({
  config: vi.fn(),
  createDestination: vi.fn(),
}));
vi.mock("../../restream/index.js", () => ({
  restreamStore: {
    config,
    createDestination,
    deleteDestination: vi.fn(),
    rotateIngestKey: vi.fn(),
    setDestinationEnabled: vi.fn(),
    updateDestination: vi.fn(),
  },
}));

import { restreamRouter } from "./restream.js";

const userId = UserIdSchema.parse(42);

function caller() {
  return restreamRouter.createCaller({
    request: new Request("https://streambrew.test/api/trpc"),
    userId,
  });
}

afterEach(() => vi.resetAllMocks());

describe("restreamRouter", () => {
  it("normalizes destinations before storing credentials for the authenticated user", async () => {
    const destinationId = "02c45e23-ccdd-4fec-9926-cba06a1b68f7";
    createDestination.mockResolvedValue(destinationId);

    await expect(
      caller().createDestination({
        platform: "youtube",
        label: "Main YouTube",
        serverUrl: " RTMPS://LIVE.Example.com/app/ ",
        streamKey: "destination-key",
      }),
    ).resolves.toEqual({ destinationId });
    expect(createDestination).toHaveBeenCalledWith(userId, {
      platform: "youtube",
      label: "Main YouTube",
      serverUrl: "rtmps://live.example.com/app",
      streamKey: "destination-key",
    });
  });

  it("rejects private destination targets at the public API seam", async () => {
    await expect(
      caller().createDestination({
        platform: "custom",
        label: "Private",
        serverUrl: "rtmp://127.0.0.1/app",
        streamKey: "destination-key",
      }),
    ).rejects.toBeInstanceOf(TRPCError);
    expect(createDestination).not.toHaveBeenCalled();
  });
});
