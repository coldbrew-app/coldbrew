import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.url(),
    DONATION_ALERTS_CLIENT_ID: z.string().refine((str) => str.length > 0 && !isNaN(Number(str))),
    DONATION_ALERTS_CLIENT_SECRET: z.string().nonempty(),
  },
  runtimeEnv: process.env,
});
