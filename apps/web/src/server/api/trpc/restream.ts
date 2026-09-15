import {
  RestreamConfigSchema,
  RestreamDestinationIdSchema,
  RestreamPlatformSchema,
  RestreamStreamKeySchema,
} from "@streambrew/packages/restream.js";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { restreamStore } from "../../restream/index.js";
import {
  RestreamDestinationLimitError,
  RestreamDestinationNotFoundError,
} from "../../restream/store.js";
import { InvalidRestreamTargetError, normalizeRestreamServerUrl } from "../../restream/target.js";
import { authenticatedProcedure, router } from "./_config.js";

function toTRPCError(error: unknown): never {
  if (error instanceof RestreamDestinationLimitError) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Restream destination limit reached.",
      cause: error,
    });
  }
  if (error instanceof RestreamDestinationNotFoundError) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Restream destination not found.",
      cause: error,
    });
  }
  if (error instanceof InvalidRestreamTargetError) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid restream destination server URL.",
      cause: error,
    });
  }
  throw error;
}

async function translateErrors<Value>(operation: () => Promise<Value>) {
  try {
    return await operation();
  } catch (error) {
    toTRPCError(error);
  }
}

export const restreamRouter = router({
  config: authenticatedProcedure
    .output(RestreamConfigSchema)
    .query(({ ctx }) => restreamStore.config(ctx.userId)),

  rotateIngestKey: authenticatedProcedure.output(z.null()).mutation(async ({ ctx }) => {
    await restreamStore.rotateIngestKey(ctx.userId);
    return null;
  }),

  createDestination: authenticatedProcedure
    .input(
      z.object({
        platform: RestreamPlatformSchema,
        label: z.string().trim().min(1).max(64),
        serverUrl: z.string().trim().min(10).max(2048),
        streamKey: RestreamStreamKeySchema,
      }),
    )
    .output(z.object({ destinationId: RestreamDestinationIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const destinationId = await translateErrors(() =>
        restreamStore.createDestination(ctx.userId, {
          ...input,
          serverUrl: normalizeRestreamServerUrl(input.serverUrl),
        }),
      );
      return { destinationId };
    }),

  updateDestination: authenticatedProcedure
    .input(
      z.object({
        destinationId: RestreamDestinationIdSchema,
        platform: RestreamPlatformSchema,
        label: z.string().trim().min(1).max(64),
        serverUrl: z.string().trim().min(10).max(2048),
        streamKey: RestreamStreamKeySchema.optional(),
      }),
    )
    .output(z.null())
    .mutation(async ({ ctx, input }) => {
      await translateErrors(() =>
        restreamStore.updateDestination(ctx.userId, input.destinationId, {
          platform: input.platform,
          label: input.label,
          serverUrl: normalizeRestreamServerUrl(input.serverUrl),
          ...(input.streamKey === undefined ? {} : { streamKey: input.streamKey }),
        }),
      );
      return null;
    }),

  setDestinationEnabled: authenticatedProcedure
    .input(
      z.object({
        destinationId: RestreamDestinationIdSchema,
        enabled: z.boolean(),
      }),
    )
    .output(z.null())
    .mutation(async ({ ctx, input }) => {
      await translateErrors(() =>
        restreamStore.setDestinationEnabled(ctx.userId, input.destinationId, input.enabled),
      );
      return null;
    }),

  deleteDestination: authenticatedProcedure
    .input(z.object({ destinationId: RestreamDestinationIdSchema }))
    .output(z.null())
    .mutation(async ({ ctx, input }) => {
      await translateErrors(() => restreamStore.deleteDestination(ctx.userId, input.destinationId));
      return null;
    }),
});
