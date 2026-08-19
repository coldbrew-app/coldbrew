import { DonationSourceSchema } from "@coldbrew/packages/schemas.js";
import { z } from "zod";

import { store } from "../../sensors/db/index.js";
import { authenticatedProcedure, router } from "./_config.js";

export const integrationRouter = router({
  disconnect: authenticatedProcedure
    .input(
      z.object({
        source: DonationSourceSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (input.source == "donationalerts") {
        await store.disconnectDonationAlerts(ctx.userId);
      }
    }),
});
