import { getEnv } from "@coldbrew/packages/getenv.js";
import { z } from "zod";

export const env = getEnv({
  DATABASE_URL: z.url(),
  DONATION_ALERTS_CLIENT_ID: z.string().refine((str) => str.length > 0 && !isNaN(+str)),
  DONATION_ALERTS_CLIENT_SECRET: z.string().nonempty(),
});
