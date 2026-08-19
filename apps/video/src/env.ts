import { getEnv } from "@coldbrew/packages/getenv.js";
import { z } from "zod";

export const env = getEnv({
  DATABASE_URL: z.url(),
});
