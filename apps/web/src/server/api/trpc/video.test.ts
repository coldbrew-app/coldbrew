import {
  MoneyAmountSchema,
  UserIdSchema,
  VideoIdSchema,
  type VideoPriority,
} from "@coldbrew/packages/schemas.js";
import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../video-queue/instance.js", () => ({ videoQueue: {} }));

import { VideoQueueError } from "../../video-queue/errors.js";
import { createVideoRouter } from "./video.js";

type VideoQueue = Parameters<typeof createVideoRouter>[0];

function createQueue(overrides: Partial<VideoQueue> = {}): VideoQueue {
  return {
    listQueues: vi.fn(),
    createQueue: vi.fn(),
    updateQueue: vi.fn(),
    moveVideo: vi.fn(),
    listPage: vi.fn(),
    retryMetadata: vi.fn(),
    addManualVideo: vi.fn(),
    listPriorities: vi.fn(async (): Promise<VideoPriority[]> => []),
    updatePriority: vi.fn(),
    updateStatus: vi.fn(),
    updateVideo: vi.fn(),
    setQueueCurrency: vi.fn(),
    listSharedPage: vi.fn(),
    ...overrides,
  };
}

function createCaller(queue: VideoQueue) {
  return createVideoRouter(queue).createCaller({
    request: new Request("http://localhost/trpc"),
    userId: UserIdSchema.parse(7),
  });
}

describe("videoRouter error translation", () => {
  it.each([
    ["video queue not found", "NOT_FOUND"],
    ["video queue name taken", "CONFLICT"],
  ] as const)("translates %s", async (type, code) => {
    const moduleError = new VideoQueueError(type);
    const caller = createCaller(
      createQueue({ createQueue: vi.fn(async () => await Promise.reject(moduleError)) }),
    );
    await expect(caller.createVideoQueue({ label: "Kick" })).rejects.toMatchObject({
      code,
      cause: moduleError,
    });
  });

  it("translates a timing failure and keeps the module error as cause", async () => {
    const moduleError = new VideoQueueError("youtube timing unavailable", {
      cause: new Error("upstream failure"),
    });
    const caller = createCaller(
      createQueue({
        addManualVideo: vi.fn(async () => await Promise.reject(moduleError)),
      }),
    );

    const error = await caller
      .addVideo({
        url: "https://youtu.be/youtube-id",
        amount: MoneyAmountSchema.parse("10"),
        startSeconds: 0,
        endSeconds: null,
      })
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(TRPCError);
    expect(error).toMatchObject({
      code: "BAD_REQUEST",
      message: "Could not read this YouTube video.",
      cause: moduleError,
    });
  });

  it.each([
    ["video not found", "updateVideo", "Video not found."],
    ["video priority not found", "updateVideoPriority", "Video priority not found."],
  ] as const)("translates %s", async (type, procedure, message) => {
    const moduleError = new VideoQueueError(type);
    const queue = createQueue({
      updateVideo: vi.fn(async () => await Promise.reject(moduleError)),
      updatePriority: vi.fn(async () => await Promise.reject(moduleError)),
    });
    const caller = createCaller(queue);
    const promise =
      procedure === "updateVideo"
        ? caller.updateVideo({
            videoId: VideoIdSchema.parse("41"),
            amount: MoneyAmountSchema.parse("10"),
            startSeconds: 0,
            endSeconds: 10,
          })
        : caller.updateVideoPriority({
            videoPriorityId: 1,
            label: "default",
            minPricePerMinute: MoneyAmountSchema.parse("0"),
          });

    await expect(promise).rejects.toMatchObject({ code: "NOT_FOUND", message });
  });

  it("does not translate unknown failures", async () => {
    const databaseError = new Error("database unavailable");
    const caller = createCaller(
      createQueue({
        updateStatus: vi.fn(async () => await Promise.reject(databaseError)),
      }),
    );

    await expect(
      caller.updateVideoStatus({
        videoId: VideoIdSchema.parse("41"),
        watchedAt: new Date(),
      }),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      cause: databaseError,
    });
  });
});

describe("video queue contracts", () => {
  it("normalizes queue names and supplies authenticated ownership", async () => {
    const queue = createQueue();
    const caller = createCaller(queue);
    await caller.createVideoQueue({ label: "  Kick  " });
    expect(queue.createQueue).toHaveBeenCalledWith(7, "Kick");
    await caller.updateVideoQueue({ videoQueueId: 2, label: "  YouTube  ", isDefault: true });
    expect(queue.updateQueue).toHaveBeenCalledWith(7, {
      videoQueueId: 2,
      label: "YouTube",
      isDefault: true,
    });
    await caller.moveVideo({ videoId: VideoIdSchema.parse("41"), videoQueueId: 2 });
    expect(queue.moveVideo).toHaveBeenCalledWith(7, VideoIdSchema.parse("41"), 2);
  });

  it("rejects empty names and invalid destination IDs before calling storage", async () => {
    const queue = createQueue();
    const caller = createCaller(queue);
    await expect(caller.createVideoQueue({ label: "   " })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(
      caller.moveVideo({ videoId: VideoIdSchema.parse("41"), videoQueueId: 0 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(queue.createQueue).not.toHaveBeenCalled();
    expect(queue.moveVideo).not.toHaveBeenCalled();
  });
});
