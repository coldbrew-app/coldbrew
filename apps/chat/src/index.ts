import { logger } from "@coldbrew/packages/logger.js";
import { rurl } from "@lebedevna/readonly-url";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import postgres from "postgres";

import { ChatApplication } from "./chat-application.js";
import { runChatCollectors } from "./collectors.js";
import {
  chatPublicUrl,
  chatServiceSecret,
  chatTokenEncryptionSecret,
  chatWebUrl,
  env,
} from "./env.js";
import { KickWebhookHandler } from "./kick-webhook.js";
import { connectChatNats } from "./nats.js";
import { ChatOauth, chatOauthConfigs } from "./oauth.js";
import type { ChatProviderAdapter } from "./provider.js";
import { KickChatProvider } from "./providers/kick.js";
import { TwitchChatProvider } from "./providers/twitch.js";
import { YoutubeChatProvider } from "./providers/youtube.js";
import { ChatStore } from "./store.js";
import { TokenCipher } from "./token-cipher.js";
import {
  ChatTokenRefresher,
  RefreshingChatProvider,
  tokenRefreshConfigs,
} from "./token-refresh.js";
import { createChatContext, createChatRouter } from "./trpc.js";

function configuredPair(clientId?: string, clientSecret?: string) {
  return clientId && clientSecret ? { clientId, clientSecret } : undefined;
}

async function main() {
  const sql = postgres(env.DATABASE_URL, { transform: postgres.camel });
  const nats = await connectChatNats(env.NATS_SERVERS);
  const store = new ChatStore(sql, new TokenCipher(chatTokenEncryptionSecret));
  const kick = env.KICK_WEBHOOK_PUBLIC_KEY
    ? configuredPair(env.KICK_CLIENT_ID, env.KICK_CLIENT_SECRET)
    : undefined;
  const youtube = configuredPair(env.YOUTUBE_CLIENT_ID, env.YOUTUBE_CLIENT_SECRET);
  const twitch = configuredPair(env.TWITCH_CLIENT_ID, env.TWITCH_CLIENT_SECRET);
  const providerConfigs = { youtube, twitch, kick };
  const oauthConfigs = chatOauthConfigs(providerConfigs);
  const oauth = new ChatOauth(store, chatPublicUrl, oauthConfigs);
  const baseProviders: ChatProviderAdapter[] = [new YoutubeChatProvider()];
  if (twitch) {
    baseProviders.push(new TwitchChatProvider(twitch.clientId, twitch.clientSecret));
  }
  if (kick) {
    baseProviders.push(new KickChatProvider());
  }
  const refresher = new ChatTokenRefresher(store, tokenRefreshConfigs(providerConfigs));
  const providers = baseProviders.map(
    (provider): ChatProviderAdapter => new RefreshingChatProvider(provider, refresher),
  );
  const application = new ChatApplication(store, nats.broker, providers, nats.collectorControl);
  const router = createChatRouter({
    application,
    oauth,
    store,
    ticketSecret: chatServiceSecret,
    webUrl: chatWebUrl,
  });
  const createContext = createChatContext(chatServiceSecret);
  const kickWebhook = env.KICK_WEBHOOK_PUBLIC_KEY
    ? new KickWebhookHandler(env.KICK_WEBHOOK_PUBLIC_KEY, store, nats.broker)
    : null;
  const serviceController = new AbortController();
  const collectors = runChatCollectors(
    store,
    nats.broker,
    nats.leases,
    nats.collectorControl,
    providers,
    serviceController.signal,
  ).catch((cause: unknown) => logger.error({ cause }, "Chat collector reconciler stopped"));

  const server = Bun.serve({
    port: env.CHAT_PORT,
    async fetch(request) {
      const url = rurl(request.url);
      if (url.pathname === "/health") {
        return Response.json({ status: "ok" });
      }
      if (url.pathname === "/webhooks/kick" && request.method === "POST") {
        if (kickWebhook === null) {
          return new Response("Kick integration is unavailable", { status: 503 });
        }
        const $handled = await kickWebhook.handle(request.headers, await request.text());
        return $handled.match(
          () => new Response(null, { status: 204 }),
          (error) => {
            logger.warn(error);
            return new Response(error.detail, {
              status: error.type === "unknown kick source" ? 202 : 401,
            });
          },
        );
      }
      const callback = url.pathname.match(/^\/oauth\/(youtube|twitch|kick)\/callback$/);
      if (callback !== null) {
        const provider = callback[1];
        if (provider !== "youtube" && provider !== "twitch" && provider !== "kick") {
          return new Response("Not found", { status: 404 });
        }
        const $completion = await oauth.finish(provider, request.url, request.signal);
        return $completion.match(
          (returnUrl) =>
            Response.redirect(rurl(returnUrl).withSearchParam("chat_oauth", "success").href),
          (error) => {
            logger.error(error);
            const returnUrl = error.returnUrl ?? rurl("/chat", chatWebUrl).href;
            return Response.redirect(rurl(returnUrl).withSearchParam("chat_oauth", "error").href);
          },
        );
      }
      if (url.pathname === "/trpc" || url.pathname.startsWith("/trpc/")) {
        return await fetchRequestHandler({
          endpoint: "/trpc",
          req: request,
          router,
          createContext,
        });
      }
      return new Response("Not found", { status: 404 });
    },
  });

  const shutdown = async () => {
    serviceController.abort();
    await server.stop(false);
    await collectors;
    await nats.close();
    await sql.end();
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
  logger.info(`Chat service listening on ${server.url.href}`);
}

await main();
