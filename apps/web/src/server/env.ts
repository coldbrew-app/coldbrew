import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.url(),
    APP_DOMAIN: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    CHAT_SERVICE_SECRET: z.string().min(32),
    CHAT_SERVICE_URL: z.url(),
    DONATIONS_SERVICE_SECRET: z.string().min(32),
    DONATIONS_SERVICE_URL: z.url(),
    GOOGLE_CLIENT_ID: z.string().nonempty(),
    GOOGLE_CLIENT_SECRET: z.string().nonempty(),
  },
  runtimeEnv: process.env,
});
