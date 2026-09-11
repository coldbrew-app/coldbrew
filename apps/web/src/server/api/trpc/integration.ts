import { DonationSourceSchema } from "@coldbrew/packages/schemas.js";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  donationIntegration,
  DonationIntegrationError,
} from "../../donation-integration/client.js";
import { authenticatedProcedure, router } from "./_config.js";

export const integrationRouter = router({
  connectDonateStream: authenticatedProcedure
    .input(
      z.object({
        widgetUrl: z.url().max(4096),
      }),
    )
    .output(z.void())
    .mutation(async ({ input, ctx }) => {
      try {
        await donationIntegration.connectDonateStream(ctx.userId, input.widgetUrl);
      } catch (cause) {
        if (cause instanceof DonationIntegrationError) {
          throw new TRPCError({
            code: cause.status === 400 ? "BAD_REQUEST" : "BAD_GATEWAY",
            message: "Could not connect donate.stream.",
            cause,
          });
        }
        throw cause;
      }
    }),

  disconnect: authenticatedProcedure
    .input(
      z.object({
        source: DonationSourceSchema,
      }),
    )
    .output(z.void())
    .mutation(async ({ input, ctx }) => {
      try {
        await donationIntegration.disconnect(input.source, ctx.userId);
      } catch (cause) {
        if (cause instanceof DonationIntegrationError) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Donation integration unavailable.",
            cause,
          });
        }
        throw cause;
      }
    }),
});
