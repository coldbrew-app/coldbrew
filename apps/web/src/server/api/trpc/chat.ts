import { TRPCError } from "@trpc/server";
import { ChatSourceSchema, parseChatSource } from "@web/lib/chat.js";
import { z } from "zod";

import { chatCollectorRegistry } from "../../chat/registry.js";
import {
  getChatConfig,
  getChatSources,
  getSourcesByOverlayToken,
  rotateOverlayToken,
  updateChatSources,
} from "../../chat/store.js";
import { authenticatedProcedure, procedure, router } from "./_config.js";

export const chatRouter = router({
  config: authenticatedProcedure.query(async ({ ctx }) => await getChatConfig(ctx.userId)),

  updateSources: authenticatedProcedure
    .input(
      z.object({
        urls: z.array(z.string().trim().min(1).max(500)).max(8),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const parsed = input.urls.map(parseChatSource);
      if (parsed.some((source) => source === null)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Unsupported YouTube or Twitch URL." });
      }
      const sources = z.array(ChatSourceSchema).parse(parsed);
      const keys = sources.map((source) => `${source.provider}:${source.sourceIdentifier}`);
      if (new Set(keys).size !== keys.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Duplicate chat source." });
      }
      return await updateChatSources(ctx.userId, sources);
    }),

  rotateOverlayToken: authenticatedProcedure.mutation(async ({ ctx }) => {
    return await rotateOverlayToken(ctx.userId);
  }),

  editorStream: authenticatedProcedure.subscription(async function* ({ ctx, signal }) {
    const sources = await getChatSources(ctx.userId);

    if (!signal) {
      const controller = new AbortController();
      signal = controller.signal;
    }

    yield* chatCollectorRegistry.stream(`user:${ctx.userId}`, sources, signal);
  }),

  overlayStream: procedure
    .input(
      z.object({
        token: z.string().min(32).max(100),
      }),
    )
    .subscription(async function* ({ input, signal }) {
      const overlay = await getSourcesByOverlayToken(input.token);
      if (!overlay) throw new TRPCError({ code: "NOT_FOUND", message: "Overlay not found." });
      const controller = signal ? null : new AbortController();

      yield* chatCollectorRegistry.stream(
        `overlay:${overlay.userId}`,
        overlay.sources,
        signal ?? controller!.signal,
      );
    }),
});
