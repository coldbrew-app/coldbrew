import { DonationSourceSchema } from "@coldbrew/packages/schemas.js";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  donationIntegration,
  DonationIntegrationError,
} from "../../donation-integration/client.js";
import { authenticatedProcedure, router } from "./_config.js";

export const integrationRouter = router({
  disconnect: authenticatedProcedure
    .input(
      z.object({
        source: DonationSourceSchema,
      }),
    )
    .output(z.void())
    .mutation(async ({ input, ctx }) => {
      if (input.source === "donationalerts") {
        try {
          await donationIntegration.disconnect(ctx.userId);
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
      }
    }),
});
