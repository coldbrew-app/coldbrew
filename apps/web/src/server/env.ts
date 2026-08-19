import { getEnv } from "@omnistream/packages/getenv.js";
import { z } from "zod";

export const env = getEnv({
  DATABASE_URL: z.url(),
  APP_DOMAIN: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  GOOGLE_CLIENT_ID: z.string().nonempty(),
  GOOGLE_CLIENT_SECRET: z.string().nonempty(),

  DONATION_ALERTS_CLIENT_ID: z.string().refine((str) => str.length > 0 && !isNaN(+str)),
  DONATION_ALERTS_CLIENT_SECRET: z.string().nonempty(),
});
