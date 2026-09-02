import { verifyChatTicket, type ChatTicketPayload } from "@coldbrew/packages/chat-ticket.js";
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
import { createAbortableStream } from "@coldbrew/packages/create-abortable-stream.js";
import { rurl } from "@lebedevna/readonly-url";
import { initTRPC, TRPCError } from "@trpc/server";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { SuperJSON } from "superjson";
import { z } from "zod";

import type { ChatApplication } from "./chat-application.js";
import type { ChatOauth } from "./oauth.js";
import type { ChatStore } from "./store.js";

const ChatOauthProviderSchema = z.enum(["youtube", "twitch", "kick"]);

type Dependencies = Readonly<{
  application: ChatApplication;
  oauth: ChatOauth;
  store: ChatStore;
  ticketSecret: string;
  webUrl: string;
}>;

type Context = Readonly<{
  request: Request;
  ticket: ChatTicketPayload | null;
}>;

function bearerToken(request: Request) {
  const value = request.headers.get("authorization");
  return value !== null && value.startsWith("Bearer ") ? value.slice("Bearer ".length) : null;
}

function applicationError(error: Readonly<{ detail: string }>): never {
  throw new TRPCError({ code: "BAD_REQUEST", message: error.detail });
}

export function createChatRouter(dependencies: Dependencies) {
  const t = initTRPC.context<Context>().create({
    transformer: SuperJSON,
    errorFormatter({ shape, error }) {
      console.error(error.stack ?? error.message);
      return shape;
    },
  });
  const editorProcedure = t.procedure.use(({ ctx, next }) => {
    if (!ctx.ticket || ctx.ticket.scope !== "editor") {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    return next({ ctx: { ...ctx, ticket: ctx.ticket } });
  });
  const ticketProcedure = t.procedure.use(({ ctx, next }) => {
    if (!ctx.ticket) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    return next({ ctx: { ...ctx, ticket: ctx.ticket } });
  });

  return t.router({
    config: editorProcedure.output(ChatConfigSchema).query(({ ctx }) => {
      return dependencies.application.config(ctx.ticket.userId);
    }),

    providerAvailability: editorProcedure
      .output(z.array(ChatProviderAvailabilitySchema))
      .query(() => [
        {
          provider: "youtube" as const,
          access: dependencies.oauth.available("youtube")
            ? ("full" as const)
            : ("unavailable" as const),
          ...(!dependencies.oauth.available("youtube")
            ? { detail: "OAuth YouTube не настроен" }
            : {}),
        },
        {
          provider: "twitch" as const,
          access: dependencies.oauth.available("twitch")
            ? ("full" as const)
            : ("unavailable" as const),
          ...(!dependencies.oauth.available("twitch")
            ? { detail: "OAuth Twitch не настроен" }
            : {}),
        },
        {
          provider: "kick" as const,
          access: dependencies.oauth.available("kick")
            ? ("full" as const)
            : ("unavailable" as const),
          ...(!dependencies.oauth.available("kick") ? { detail: "OAuth Kick не настроен" } : {}),
        },
        {
          provider: "boosty" as const,
          access: "unavailable" as const,
          detail: "У Boosty пока нет публичного официального API чата",
        },
        {
          provider: "vk_video" as const,
          access: "unavailable" as const,
          detail: "Read-only подключение появится после регистрации VK-приложения",
        },
      ]),

    startOauth: editorProcedure
      .input(z.object({ provider: ChatOauthProviderSchema }))
      .output(z.object({ authorizationUrl: z.url() }))
      .mutation(async ({ ctx, input }) => {
        const returnUrl = rurl("/chat", dependencies.webUrl).href;
        console.debug({ returnUrl });
        const $url = await dependencies.oauth.start(ctx.ticket.userId, input.provider, returnUrl);
        return $url.match((authorizationUrl) => ({ authorizationUrl }), applicationError);
      }),

    disconnect: editorProcedure
      .input(z.object({ connectionId: ChatProviderConnectionIdSchema }))
      .mutation(async ({ ctx, input }) => {
        await dependencies.store.disconnect(ctx.ticket.userId, input.connectionId);
      }),

    refreshSource: editorProcedure
      .input(
        z.object({
          sourceId: ChatSourceIdSchema,
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const $result = await dependencies.application.refreshSource(
          ctx.ticket.userId,
          input.sourceId,
        );
        return $result.match(() => undefined, applicationError);
      }),

    broadcast: editorProcedure
      .input(z.object({ text: z.string().max(MAX_CHAT_MESSAGE_LENGTH) }))
      .output(ChatBroadcastResultSchema)
      .mutation(async ({ ctx, input, signal }) => {
        const $result = await dependencies.application.broadcast(
          ctx.ticket.userId,
          input.text,
          signal ?? ctx.request.signal,
        );
        return $result.match((result) => result, applicationError);
      }),

    moderate: editorProcedure
      .input(ChatModerationCommandSchema)
      .output(ChatCommandResultSchema)
      .mutation(async ({ ctx, input, signal }) => {
        const $result = await dependencies.application.moderate(
          ctx.ticket.userId,
          input,
          signal ?? ctx.request.signal,
        );
        return $result.match((result) => result, applicationError);
      }),

    stream: editorProcedure.subscription(({ ctx, signal: parentSignal }) =>
      createAbortableStream(async function* (signal) {
        yield* dependencies.application.stream(ctx.ticket.userId, signal);
      }, parentSignal),
    ),

    overlayStream: ticketProcedure.subscription(({ ctx, signal: parentSignal }) =>
      createAbortableStream(async function* (signal) {
        yield* dependencies.application.stream(ctx.ticket.userId, signal);
      }, parentSignal),
    ),
  });
}

export function createChatContext(ticketSecret: string) {
  return async ({ req }: FetchCreateContextFnOptions): Promise<Context> => {
    const token = bearerToken(req);
    if (token === null) {
      return { request: req, ticket: null };
    }
    const $ticket = verifyChatTicket(ticketSecret, token);
    return { request: req, ticket: $ticket.isOk() ? $ticket.value : null };
  };
}

export type ChatRouter = ReturnType<typeof createChatRouter>;
