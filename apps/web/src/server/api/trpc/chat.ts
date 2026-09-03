import {
  ChatBroadcastResultSchema,
  ChatCommandResultSchema,
  ChatConfigSchema,
  ChatModerationCommandSchema,
  ChatProviderAvailabilitySchema,
  ChatProviderConnectionIdSchema,
  ChatSourceIdSchema,
  MAX_CHAT_MESSAGE_LENGTH,
} from "@coldbrew/packages/chat.js";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { chatService, ChatServiceError } from "../../chat/client.js";
import { getUserIdByOverlayToken, rotateOverlayToken } from "../../chat/store.js";
import { authenticatedProcedure, procedure, router } from "./_config.js";

function toTRPCError(error: ChatServiceError) {
  if (error.status === 400) {
    return new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid chat request.",
      cause: error,
    });
  }
  if (error.status === 404) {
    return new TRPCError({
      code: "NOT_FOUND",
      message: "Chat resource not found.",
      cause: error,
    });
  }
  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Chat service unavailable.",
    cause: error,
  });
}

async function callChatService<Value>(operation: Promise<Value>): Promise<Value> {
  try {
    return await operation;
  } catch (error) {
    if (error instanceof ChatServiceError) {
      throw toTRPCError(error);
    }
    throw error;
  }
}

async function* streamForUser(userId: number, signal?: AbortSignal) {
  if (signal === undefined) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Chat subscription cancellation is unavailable.",
    });
  }
  try {
    yield* chatService.stream(userId, signal);
  } catch (error) {
    if (error instanceof ChatServiceError) {
      throw toTRPCError(error);
    }
    throw error;
  }
}

export const chatRouter = router({
  config: authenticatedProcedure
    .output(ChatConfigSchema)
    .query(({ ctx }) => callChatService(chatService.config(ctx.userId))),

  providerAvailability: authenticatedProcedure
    .output(z.array(ChatProviderAvailabilitySchema))
    .query(() => callChatService(chatService.providerAvailability())),

  startOauth: authenticatedProcedure
    .input(
      z.object({
        provider: z.enum(["youtube", "twitch", "kick"]),
      }),
    )
    .output(
      z.object({
        authorizationUrl: z.url(),
      }),
    )
    .mutation(({ ctx, input }) =>
      callChatService(chatService.startOauth(ctx.userId, input.provider)),
    ),

  disconnect: authenticatedProcedure
    .input(
      z.object({
        connectionId: ChatProviderConnectionIdSchema,
      }),
    )
    .output(z.void())
    .mutation(async ({ ctx, input }) => {
      await callChatService(chatService.disconnect(ctx.userId, input.connectionId));
    }),

  refreshSource: authenticatedProcedure
    .input(
      z.object({
        sourceId: ChatSourceIdSchema,
      }),
    )
    .output(z.void())
    .mutation(async ({ ctx, input }) => {
      await callChatService(chatService.refreshSource(ctx.userId, input.sourceId));
    }),

  broadcast: authenticatedProcedure
    .input(
      z.object({
        text: z.string().max(MAX_CHAT_MESSAGE_LENGTH),
      }),
    )
    .output(ChatBroadcastResultSchema)
    .mutation(({ ctx, input }) => callChatService(chatService.broadcast(ctx.userId, input.text))),

  moderate: authenticatedProcedure
    .input(ChatModerationCommandSchema)
    .output(ChatCommandResultSchema)
    .mutation(({ ctx, input }) => callChatService(chatService.moderate(ctx.userId, input))),

  stream: authenticatedProcedure.subscription(({ ctx, signal }) =>
    streamForUser(ctx.userId, signal),
  ),

  overlayStream: procedure
    .input(
      z.object({
        token: z.string().min(32).max(100),
      }),
    )
    .subscription(async function* ({ input, signal }) {
      const userId = await getUserIdByOverlayToken(input.token);
      if (userId === null) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Chat overlay not found." });
      }
      yield* streamForUser(userId, signal);
    }),

  rotateOverlayToken: authenticatedProcedure
    .output(
      z.object({
        token: z.string().min(32).max(100),
        overlayUrl: z.url(),
      }),
    )
    .mutation(({ ctx }) => rotateOverlayToken(ctx.userId)),
});
