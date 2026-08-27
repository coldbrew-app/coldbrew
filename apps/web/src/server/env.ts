import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.url(),
    APP_DOMAIN: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    GOOGLE_CLIENT_ID: z.string().nonempty(),
    GOOGLE_CLIENT_SECRET: z.string().nonempty(),

    YOUTUBE_API_KEY: z.string().nonempty(),

    DONATION_ALERTS_CLIENT_ID: z.string().refine((str) => str.length > 0 && !isNaN(+str)),
    DONATION_ALERTS_CLIENT_SECRET: z.string().nonempty(),
  },
  runtimeEnv: process.env,
});
