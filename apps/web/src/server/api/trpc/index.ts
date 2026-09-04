import { PublicQueueSettingsSchema, SlugSchema } from "@coldbrew/packages/schemas.js";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { donationAlertsAuthorizationURL } from "../../donationalerts.js";
import { store } from "../../sensors/db/index.js";
import { authenticatedProcedure, procedure, router } from "./_config.js";
import { chatRouter } from "./chat.js";
import { integrationRouter } from "./integration.js";
import { videoProcedures } from "./video.js";

const PAGE_SIZE = 25;
const PageSchema = z.int().positive();
const DonationPeriodSchema = z.enum(["all", "week", "month"]);

export const appRouter = router({
  chat: chatRouter,
  integration: integrationRouter,
  ...videoProcedures,

  authUrls: authenticatedProcedure
    .output(
      z.object({
        donationAlerts: z.url(),
      }),
    )
    .query(async () => ({ donationAlerts: await donationAlertsAuthorizationURL() })),

  userInfo: procedure.query(async ({ ctx }) => {
    if (ctx.userId === null) {
      return null;
    }
    return await store.getUserInfo(ctx.userId);
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
