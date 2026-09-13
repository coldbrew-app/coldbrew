import { createSql } from "@coldbrew/packages/pg.js";
import { betterAuth } from "better-auth";
import { PostgresJSDialect } from "kysely-postgres-js";

import { env } from "../env.js";

const authSql = createSql(env.DATABASE_URL, { searchPath: "auth" });

export const auth = betterAuth({
  baseURL: env.APP_DOMAIN,
  database: {
    type: "postgres",
    dialect: new PostgresJSDialect({ postgres: authSql }),
  },
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    },
  },
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
