import { createChatTicket } from "@coldbrew/packages/chat-ticket.js";
import { z } from "zod";

import { getUserIdByOverlayToken, rotateOverlayToken } from "../../chat/store.js";
import { chatServiceSecret } from "../../env.js";
import { authenticatedProcedure, procedure, router } from "./_config.js";

export const chatRouter = router({
  ticket: authenticatedProcedure.query(({ ctx }) => ({
    ticket: createChatTicket(chatServiceSecret, ctx.userId, "editor"),
  })),

  overlayTicket: procedure
    .input(z.object({ token: z.string().min(32).max(100) }))
    .query(async ({ input }) => {
      const userId = await getUserIdByOverlayToken(input.token);
      return userId ? { ticket: createChatTicket(chatServiceSecret, userId, "overlay") } : null;
    }),

  rotateOverlayToken: authenticatedProcedure.mutation(async ({ ctx }) => {
    return await rotateOverlayToken(ctx.userId);
  }),
});
