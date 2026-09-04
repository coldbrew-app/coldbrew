import {
  MoneyAmountSchema,
  QueueCurrencySchema,
  SharedVideoSchema,
  SlugSchema,
  VideoIdSchema,
} from "@coldbrew/packages/schemas.js";
import { youtubeVideoId } from "@coldbrew/packages/youtube.js";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { VideoQueueError } from "../../video-queue/errors.js";
import { videoQueue } from "../../video-queue/instance.js";
import { authenticatedProcedure, procedure, router } from "./_config.js";

type VideoQueue = Pick<
  typeof videoQueue,
  | "addManualVideo"
  | "listPage"
  | "listPriorities"
  | "listSharedPage"
  | "setQueueCurrency"
  | "updatePriority"
  | "updateStatus"
  | "updateVideo"
>;

const PAGE_SIZE = 25;
const PageSchema = z.int().positive();
const VideoStatusSchema = z.enum(["all", "notwatched", "watched", "bookmarked"]);
const SharedVideoStatusSchema = z.enum(["queue", "watched"]);
const SharedVideoPageSchema = z
  .object({
    items: z.array(SharedVideoSchema),
    page: PageSchema,
    pageSize: PageSchema,
    priorities: z.array(
      z.object({
        videoPriorityId: z.int().positive(),
        label: z.string().trim().min(1).max(64),
        videoCount: z.int().nonnegative(),
        remainingSeconds: z.int().nonnegative(),
      }),
    ),
    showWatchedVideos: z.boolean(),
    status: SharedVideoStatusSchema,
    total: z.int().nonnegative(),
    totalPages: z.int().nonnegative(),
  })
  .nullable();

function translateVideoQueueError(error: unknown): never {
  if (!(error instanceof VideoQueueError)) {
    throw error;
  }

  switch (error.type) {
    case "invalid youtube url":
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Invalid YouTube URL.",
        cause: error,
      });
    case "youtube timing unavailable":
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Could not read this YouTube video.",
        cause: error,
      });
    case "video not found":
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Video not found.",
        cause: error,
      });
    case "video priority not found":
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Video priority not found.",
        cause: error,
      });
  }
}

function createVideoProcedures(queue: VideoQueue) {
  return {
    updateQueueCurrency: authenticatedProcedure
      .input(
        z.object({
          queueCurrency: QueueCurrencySchema,
          rate: MoneyAmountSchema.refine((rate) => rate !== "0.00"),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        return await queue.setQueueCurrency(ctx.userId, input.queueCurrency, input.rate);
      }),

    videoPage: authenticatedProcedure
      .input(
        z.object({
          page: PageSchema,
          videoPriorityId: z.int().positive().nullable(),
          videoStatus: VideoStatusSchema,
        }),
      )
      .query(async ({ ctx, input }) => {
        return await queue.listPage(ctx.userId, {
          ...input,
          pageSize: PAGE_SIZE,
        });
      }),

    addVideo: authenticatedProcedure
      .input(
        z
          .object({
            url: z.url().refine((url) => youtubeVideoId(url) !== null),
            amount: MoneyAmountSchema,
            startSeconds: z.int().nonnegative(),
            endSeconds: z.int().positive().nullable(),
          })
          .refine(
            ({ startSeconds, endSeconds }) => endSeconds === null || endSeconds > startSeconds,
            {
              message: "Video end must be after video start.",
              path: ["endSeconds"],
            },
          ),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await queue.addManualVideo(ctx.userId, input);
        } catch (error) {
          translateVideoQueueError(error);
        }
      }),

    videoPriorities: authenticatedProcedure.query(async ({ ctx }) => {
      return await queue.listPriorities(ctx.userId);
    }),

    updateVideoPriority: authenticatedProcedure
      .input(
        z.object({
          videoPriorityId: z.int().positive(),
          label: z.string().trim().min(1).max(64),
          minPricePerMinute: MoneyAmountSchema,
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await queue.updatePriority(ctx.userId, input);
        } catch (error) {
          translateVideoQueueError(error);
        }
      }),

    updateVideoStatus: authenticatedProcedure
      .input(
        z
          .object({
            videoId: VideoIdSchema,
            watchedAt: z.date().nullable().optional(),
            bookmarkedAt: z.date().nullable().optional(),
          })
          .refine((input) => input.watchedAt !== undefined || input.bookmarkedAt !== undefined),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          await queue.updateStatus(ctx.userId, input.videoId, input);
        } catch (error) {
          translateVideoQueueError(error);
        }
      }),

    updateVideo: authenticatedProcedure
      .input(
        z
          .object({
            videoId: VideoIdSchema,
            amount: MoneyAmountSchema,
            startSeconds: z.int().nonnegative(),
            endSeconds: z.int().positive(),
          })
          .refine(({ startSeconds, endSeconds }) => endSeconds > startSeconds, {
            message: "Video end must be after video start.",
            path: ["endSeconds"],
          }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          await queue.updateVideo(ctx.userId, input.videoId, input);
        } catch (error) {
          translateVideoQueueError(error);
        }
      }),

    sharedVideoPage: procedure
      .input(
        z.object({
          page: PageSchema,
          slug: SlugSchema,
          status: SharedVideoStatusSchema,
        }),
      )
      .output(SharedVideoPageSchema)
      .query(async ({ input }) => {
        return await queue.listSharedPage(input.slug, {
          page: input.page,
          pageSize: PAGE_SIZE,
          status: input.status,
        });
      }),
  };
}

export function createVideoRouter(queue: VideoQueue) {
  return router(createVideoProcedures(queue));
}

export const videoProcedures = createVideoProcedures(videoQueue);
