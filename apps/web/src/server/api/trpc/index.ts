import { MoneyAmountSchema, SlugSchema, VideoIdSchema } from "@coldbrew/packages/schemas.js";
import { rurl } from "@lebedevna/readonly-url";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { getRequestOrigin } from "../../lib/request-origin.js";
import { store } from "../../sensors/db/index.js";
import { donationAlerts } from "../../sensors/donationalerts.js";
import { authenticatedProcedure, procedure, router } from "./_config.js";
import { integrationRouter } from "./integration.js";

export const appRouter = router({
  integration: integrationRouter,

  authUrls: authenticatedProcedure.query(({ ctx }) => {
    const redirectUri = rurl(
      "/api/integration/donationalerts/callback",
      getRequestOrigin(ctx.request),
    ).href;
    return { donationAlerts: donationAlerts.getAuthorizationUrl(redirectUri) };
  }),

  userInfo: procedure.query(async ({ ctx }) => {
    if (ctx.userId === null) return null;
    return await store.getUserInfo(ctx.userId);
  }),

  donations: authenticatedProcedure.query(async ({ ctx }) => {
    return await store.listDonations(ctx.userId);
  }),

  videos: authenticatedProcedure.query(async ({ ctx }) => {
    return await store.listVideos(ctx.userId);
  }),

  videoPriorities: authenticatedProcedure.query(async ({ ctx }) => {
    return await store.listVideoPriorities(ctx.userId);
  }),

  updateVideoPriority: authenticatedProcedure
    .input(
      z.object({
        videoPriorityId: z.number().int().positive(),
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
          savedAt: z.date().nullable().optional(),
        })
        .refine((input) => input.watchedAt !== undefined || input.savedAt !== undefined),
    )
    .mutation(async ({ ctx, input }) => {
      const wasUpdated = await store.updateVideoStatus(ctx.userId, input.videoId, input);

      if (!wasUpdated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Video not found." });
      }
    }),

  updateVideo: authenticatedProcedure
    .input(
      z.object({
        videoId: VideoIdSchema,
        amount: MoneyAmountSchema,
        durationMinutes: z.number().int().positive(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const wasUpdated = await store.updateVideo(
        ctx.userId,
        input.videoId,
        input.amount,
        input.durationMinutes,
      );

      if (!wasUpdated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Video not found." });
      }
    }),

  sharedVideos: procedure
    .input(
      z.object({
        slug: SlugSchema,
      }),
    )
    .query(async ({ input }) => {
      return await store.listSharedVideos(input.slug);
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
