import { rurl } from "@lebedevna/readonly-url";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  emptyStringAsUndefined: true,
  server: {
    APP_DOMAIN: z.url().optional(),
    BETTER_AUTH_SECRET: z.string().min(32).optional(),
    DATABASE_URL: z.url(),

    NATS_SERVERS: z.string().min(1).default("nats://localhost:4222"),

    CHAT_PORT: z.coerce.number().int().positive().default(3001),
    CHAT_PUBLIC_URL: z.url().optional(),
    CHAT_WEB_URL: z.url().optional(),

    CHAT_SERVICE_SECRET: z.string().min(32).optional(),
    CHAT_TOKEN_ENCRYPTION_SECRET: z.string().min(32).optional(),

    YOUTUBE_CLIENT_ID: z.string().min(1).optional(),
    YOUTUBE_CLIENT_SECRET: z.string().min(1).optional(),

    TWITCH_CLIENT_ID: z.string().min(1).optional(),
    TWITCH_CLIENT_SECRET: z.string().min(1).optional(),

    KICK_CLIENT_ID: z.string().min(1).optional(),
    KICK_CLIENT_SECRET: z.string().min(1).optional(),
    KICK_WEBHOOK_PUBLIC_KEY: z.string().min(1).optional(),
  },
  runtimeEnv: process.env,
});

function requiredSecret(explicit: string | undefined, name: string) {
  const value = explicit ?? env.BETTER_AUTH_SECRET;
  if (!value) {
    throw new Error(`${name} or BETTER_AUTH_SECRET is required`);
  }
  return value;
}

export const chatServiceSecret = requiredSecret(env.CHAT_SERVICE_SECRET, "CHAT_SERVICE_SECRET");
export const chatTokenEncryptionSecret = requiredSecret(
  env.CHAT_TOKEN_ENCRYPTION_SECRET,
  "CHAT_TOKEN_ENCRYPTION_SECRET",
);

function requiredUrl(explicit: string | undefined, name: string) {
  const value = explicit ?? env.APP_DOMAIN;
  if (!value) {
    throw new Error(`${name} or APP_DOMAIN is required`);
  }
  return value;
}

export const chatWebUrl = requiredUrl(env.CHAT_WEB_URL, "CHAT_WEB_URL");
export const chatPublicUrl =
  env.CHAT_PUBLIC_URL ?? rurl("/api/chat", requiredUrl(env.APP_DOMAIN, "APP_DOMAIN")).href;
