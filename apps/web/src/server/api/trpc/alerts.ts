import {
  AlertAssetIdSchema,
  AlertDashboardSchema,
  AlertOverlayOpenSchema,
  AlertOverlayTokenSchema,
  AlertPlaybackIdSchema,
  AlertRendererDiagnosticCodeSchema,
  AlertSettingsSchema,
} from "@coldbrew/packages/alerts.js";
import { rurl } from "@lebedevna/readonly-url";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { donationAlertService, DonationAlertServiceError } from "../../donation-alert/client.js";
import { env } from "../../env.js";
import { authenticatedProcedure, procedure, router } from "./_config.js";

const PlayerIdentitySchema = z.object({
  token: AlertOverlayTokenSchema,
  playerId: z.uuid(),
  generation: z.int().positive(),
});
const alertServiceTimeoutMs = 30_000;

function toTRPCError(error: DonationAlertServiceError) {
  if (error.status === 400) {
    return new TRPCError({ code: "BAD_REQUEST", message: "Invalid alert request.", cause: error });
  }
  if (error.status === 404) {
    return new TRPCError({ code: "NOT_FOUND", message: "Alert resource not found.", cause: error });
  }
  if (error.status === 409) {
    return new TRPCError({ code: "CONFLICT", message: "Alert state changed.", cause: error });
  }
  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Alert service unavailable.",
    cause: error,
  });
}

async function callAlertService<Value>(
  requestSignal: AbortSignal,
  operation: (signal: AbortSignal) => Promise<Value>,
): Promise<Value> {
  const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(alertServiceTimeoutMs)]);
  try {
    return await operation(signal);
  } catch (error) {
    if (error instanceof DonationAlertServiceError) throw toTRPCError(error);
    throw error;
  }
}

export const alertsRouter = router({
  dashboard: authenticatedProcedure
    .output(AlertDashboardSchema)
    .query(({ ctx }) =>
      callAlertService(ctx.request.signal, (signal) =>
        donationAlertService.dashboard(ctx.userId, signal),
      ),
    ),

  updateSettings: authenticatedProcedure
    .input(AlertSettingsSchema)
    .output(z.null())
    .mutation(({ ctx, input }) =>
      callAlertService(ctx.request.signal, (signal) =>
        donationAlertService.updateSettings(ctx.userId, input, signal),
      ),
    ),

  rotateOverlayToken: authenticatedProcedure
    .output(z.object({ overlayUrl: z.url() }))
    .mutation(async ({ ctx }) => {
      const { token } = await callAlertService(ctx.request.signal, (signal) =>
        donationAlertService.rotateToken(ctx.userId, signal),
      );
      return { overlayUrl: rurl("/alerts/overlay", env.APP_DOMAIN).withHash(token).href };
    }),

  test: authenticatedProcedure
    .output(z.null())
    .mutation(({ ctx }) =>
      callAlertService(ctx.request.signal, (signal) =>
        donationAlertService.test(ctx.userId, signal),
      ),
    ),

  setPaused: authenticatedProcedure
    .input(z.object({ paused: z.boolean() }))
    .output(z.null())
    .mutation(({ ctx, input }) =>
      callAlertService(ctx.request.signal, (signal) =>
        donationAlertService.setPaused(ctx.userId, input.paused, signal),
      ),
    ),

  skip: authenticatedProcedure
    .output(z.null())
    .mutation(({ ctx }) =>
      callAlertService(ctx.request.signal, (signal) =>
        donationAlertService.skip(ctx.userId, signal),
      ),
    ),

  replay: authenticatedProcedure
    .input(z.object({ playbackId: AlertPlaybackIdSchema }))
    .output(z.null())
    .mutation(({ ctx, input }) =>
      callAlertService(ctx.request.signal, (signal) =>
        donationAlertService.replay(ctx.userId, input.playbackId, signal),
      ),
    ),

  deleteAsset: authenticatedProcedure
    .input(z.object({ assetId: AlertAssetIdSchema }))
    .output(z.null())
    .mutation(({ ctx, input }) =>
      callAlertService(ctx.request.signal, (signal) =>
        donationAlertService.deleteAsset(ctx.userId, input.assetId, signal),
      ),
    ),

  openOverlay: procedure
    .input(z.object({ token: AlertOverlayTokenSchema }))
    .output(AlertOverlayOpenSchema)
    .mutation(({ ctx, input }) =>
      callAlertService(ctx.request.signal, (signal) =>
        donationAlertService.openOverlay(input.token, signal),
      ),
    ),

  heartbeat: procedure
    .input(
      PlayerIdentitySchema.extend({
        active: z.boolean(),
        visible: z.boolean(),
      }),
    )
    .output(z.null())
    .mutation(({ ctx, input }) =>
      callAlertService(ctx.request.signal, (signal) =>
        donationAlertService.heartbeat(
          input.token,
          input.playerId,
          input.generation,
          input.active,
          input.visible,
          signal,
        ),
      ),
    ),

  started: procedure
    .input(PlayerIdentitySchema.extend({ playbackId: AlertPlaybackIdSchema }))
    .output(z.null())
    .mutation(({ ctx, input }) =>
      callAlertService(ctx.request.signal, (signal) =>
        donationAlertService.started(
          input.token,
          input.playerId,
          input.generation,
          input.playbackId,
          signal,
        ),
      ),
    ),

  finished: procedure
    .input(
      PlayerIdentitySchema.extend({
        playbackId: AlertPlaybackIdSchema,
        outcome: z.enum(["completed", "interrupted"]),
      }),
    )
    .output(z.null())
    .mutation(({ ctx, input }) =>
      callAlertService(ctx.request.signal, (signal) =>
        donationAlertService.finished(
          input.token,
          input.playerId,
          input.generation,
          input.playbackId,
          input.outcome,
          signal,
        ),
      ),
    ),

  diagnostic: procedure
    .input(
      PlayerIdentitySchema.extend({
        playbackId: AlertPlaybackIdSchema,
        code: AlertRendererDiagnosticCodeSchema,
      }),
    )
    .output(z.null())
    .mutation(({ ctx, input }) =>
      callAlertService(ctx.request.signal, (signal) =>
        donationAlertService.diagnostic(
          input.token,
          input.playerId,
          input.generation,
          input.playbackId,
          input.code,
          signal,
        ),
      ),
    ),
});
