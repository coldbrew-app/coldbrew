import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  emptyStringAsUndefined: true,
  server: {
    APP_DOMAIN: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    DATABASE_URL: z.url(),

    NATS_SERVERS: z.string().min(1),

    CHAT_PORT: z.coerce.number().int().positive(),
    CHAT_WEB_URL: z.url(),

    CHAT_SERVICE_SECRET: z.string().min(32),
    CHAT_TOKEN_ENCRYPTION_SECRET: z.string().min(32),

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

export const chatServiceSecret = env.CHAT_SERVICE_SECRET;
export const chatTokenEncryptionSecret = env.CHAT_TOKEN_ENCRYPTION_SECRET;
export const chatWebUrl = env.CHAT_WEB_URL;
