import { createAbortableStream } from "@coldbrew/packages/create-abortable-stream.js";
import type { ChatConnectionErrorCode, ChatSource, ChatStreamEvent } from "@web/lib/chat.js";
import { ChatSourceListSchema } from "@web/lib/chat.js";
import { z } from "zod";

import { chatCollectorRegistry, type ChatRegistryError } from "../../chat/registry.js";
import {
  getChatConfig,
  getChatSources,
  getSourcesByOverlayToken,
  rotateOverlayToken,
  updateChatSources,
} from "../../chat/store.js";
import { authenticatedProcedure, procedure, router } from "./_config.js";

function connectionErrorEvent(code: ChatConnectionErrorCode, detail: string): ChatStreamEvent {
  return { type: "connection_error", error: { code, detail } };
}

function registryErrorEvent(error: ChatRegistryError): ChatStreamEvent {
  return error.type === "session limit"
    ? connectionErrorEvent("session_limit", "Too many chat connections are already open")
    : connectionErrorEvent("stream_unavailable", "The chat stream is temporarily unavailable");
}

async function* streamChatSources(
  sessionKey: string,
  sources: readonly ChatSource[],
  signal: AbortSignal,
) {
  for await (const $event of chatCollectorRegistry.stream(sessionKey, sources, signal)) {
    if ($event.isErr()) {
      yield registryErrorEvent($event.error);
      return;
    }
    yield $event.value;
  }
}

export const chatRouter = router({
  config: authenticatedProcedure.query(async ({ ctx }) => await getChatConfig(ctx.userId)),

  updateSources: authenticatedProcedure
    .input(
      z.object({
        sourceUrls: ChatSourceListSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return await updateChatSources(ctx.userId, input.sourceUrls);
    }),

  rotateOverlayToken: authenticatedProcedure.mutation(async ({ ctx }) => {
    return await rotateOverlayToken(ctx.userId);
  }),

  editorStream: authenticatedProcedure.subscription(({ ctx, signal: parentSignal }) =>
    createAbortableStream(async function* (signal) {
      const sources = await getChatSources(ctx.userId);
      yield* streamChatSources(`user:${ctx.userId}`, sources, signal);
    }, parentSignal),
  ),

  overlayStream: procedure
    .input(
      z.object({
        token: z.string().min(32).max(100),
      }),
    )
    .subscription(({ input, signal: parentSignal }) =>
      createAbortableStream(async function* (signal) {
        const overlay = await getSourcesByOverlayToken(input.token);
        if (!overlay) {
          yield connectionErrorEvent("overlay_not_found", "Overlay not found");
          return;
        }

        yield* streamChatSources(`overlay:${overlay.userId}`, overlay.sources, signal);
      }, parentSignal),
    ),
});
