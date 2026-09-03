import {
  MoneyAmountSchema,
  PublicQueueSettingsSchema,
  QueueCurrencySchema,
  SharedVideoSchema,
  SlugSchema,
  VideoIdSchema,
} from "@coldbrew/packages/schemas.js";
import { youtubeVideoId } from "@coldbrew/packages/youtube.js";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { donationAlertsAuthorizationURL } from "../../donationalerts.js";
import { store } from "../../sensors/db/index.js";
import { getYoutubeTiming } from "../../youtube.js";
import { authenticatedProcedure, procedure, router } from "./_config.js";
import { chatRouter } from "./chat.js";
import { integrationRouter } from "./integration.js";

const PAGE_SIZE = 25;
const PageSchema = z.int().positive();
const DonationPeriodSchema = z.enum(["all", "week", "month"]);
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

export const appRouter = router({
  chat: chatRouter,
  integration: integrationRouter,

  authUrls: authenticatedProcedure
    .output(
      z.object({
        donationAlerts: z.url(),
      }),
    )
    .query(() => ({ donationAlerts: donationAlertsAuthorizationURL() })),

  userInfo: procedure.query(async ({ ctx }) => {
    if (ctx.userId === null) {
      return null;
    }
    return await store.getUserInfo(ctx.userId);
  }),

  updateQueueCurrency: authenticatedProcedure
    .input(
      z.object({
        queueCurrency: QueueCurrencySchema,
        rate: MoneyAmountSchema.refine((rate) => rate !== "0.00"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return await store.setQueueCurrency(ctx.userId, input.queueCurrency, input.rate);
    }),

  updatePublicQueueSettings: authenticatedProcedure
    .input(PublicQueueSettingsSchema)
    .output(PublicQueueSettingsSchema)
    .mutation(async ({ ctx, input }) => {
      return await store.setPublicQueueSettings(ctx.userId, input);
    }),

  donationPage: authenticatedProcedure
    .input(
      z.object({
        page: PageSchema,
        period: DonationPeriodSchema,
        query: z.string().trim().max(200),
      }),
    )
    .query(async ({ ctx, input }) => {
      const periodDays = input.period === "week" ? 7 : input.period === "month" ? 30 : null;
      const occurredAfter =
        periodDays === null ? null : new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);
      return await store.listDonationsPage(ctx.userId, {
        ...input,
        occurredAfter,
        pageSize: PAGE_SIZE,
      });
    }),

  donationOverview: authenticatedProcedure.query(async ({ ctx }) => {
    return await store.getDonationOverview(ctx.userId);
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
      return await store.listVideosPage(ctx.userId, { ...input, pageSize: PAGE_SIZE });
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
      const providerVideoId = youtubeVideoId(input.url);
      if (providerVideoId === null) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid YouTube URL." });
      }

      let timing;
      try {
        timing = await getYoutubeTiming(input.url, {
          startSeconds: input.startSeconds,
          endSeconds: input.endSeconds,
        });
      } catch (cause) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Could not read this YouTube video.",
          cause,
        });
      }

      const videoId = await store.addManualVideo(ctx.userId, {
        providerVideoId,
        url: input.url,
        queueAmount: input.amount,
        ...timing,
      });
      return { videoId };
    }),

  videoPriorities: authenticatedProcedure.query(async ({ ctx }) => {
    return await store.listVideoPriorities(ctx.userId);
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
      const priority = await store.updateVideoPriority(
        ctx.userId,
        input.videoPriorityId,
        input.label,
        input.minPricePerMinute,
      );

      if (priority === null) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Video priority not found." });
      }

      return priority;
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
      const wasUpdated = await store.updateVideoStatus(ctx.userId, input.videoId, input);

      if (!wasUpdated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Video not found." });
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
      const wasUpdated = await store.updateVideo(
        ctx.userId,
        input.videoId,
        input.amount,
        input.startSeconds,
        input.endSeconds,
      );

      if (!wasUpdated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Video not found." });
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
      return await store.listSharedVideosPage(input.slug, {
        page: input.page,
        pageSize: PAGE_SIZE,
        status: input.status,
      });
    }),

  updateSlug: authenticatedProcedure
    .input(
      z.object({
        slug: SlugSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const wasUpdated = await store.setSlug(ctx.userId, input.slug);

      if (!wasUpdated) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This slug is already in use.",
        });
      }

      return { slug: input.slug };
    }),
});

export type AppRouter = typeof appRouter;
