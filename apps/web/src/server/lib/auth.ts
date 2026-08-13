import { betterAuth } from "better-auth";
import { PostgresJSDialect } from "kysely-postgres-js";

import { env } from "../env.js";
import { sql } from "../sensors/db/index.js";

export const auth = betterAuth({
  baseURL: env.AUTH_BASE_URL,
  database: {
    type: "postgres",
    dialect: new PostgresJSDialect({ postgres: sql }),
  },
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    },
  },
  trustedOrigins: [env.AUTH_BASE_URL],
  user: {
    // Keep Better Auth's users separate from the app's existing `user` table.
    modelName: "auth_user",
  },
  session: {
    modelName: "auth_session",
  },
  account: {
    modelName: "auth_account",
  },
  verification: {
    modelName: "auth_verification",
  },
});

export type Session = typeof auth.$Infer.Session;
