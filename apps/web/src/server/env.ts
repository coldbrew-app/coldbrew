import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.url(),
    APP_DOMAIN: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    CHAT_SERVICE_SECRET: z.string().min(32).optional(),
    GOOGLE_CLIENT_ID: z.string().nonempty(),
    GOOGLE_CLIENT_SECRET: z.string().nonempty(),

    DONATION_ALERTS_CLIENT_ID: z.string().refine((str) => str.length > 0 && !isNaN(+str)),
    DONATION_ALERTS_CLIENT_SECRET: z.string().nonempty(),
  },
  runtimeEnv: process.env,
});

export const chatServiceSecret = env.CHAT_SERVICE_SECRET ?? env.BETTER_AUTH_SECRET;
