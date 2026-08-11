import { jsonb } from "@omnistream/packages/jsonb.js";
import {
  AccessToken,
  AccessTokenSchema,
  Donation,
  DonationSchema,
  RefreshToken,
  RefreshTokenSchema,
  UserId,
  UserIdSchema,
} from "@omnistream/packages/schemas.js";
import postgres from "postgres";
import { z } from "zod";

import { env } from "../../env.js";

export const sql = postgres(env.DATABASE_URL, {
  transform: postgres.camel,
});

export class Store {
  async insertDonations(userId: UserId, donations: Omit<Donation, "donationId">[]) {
    const input = jsonb(sql, donations);

    const rows = await sql`
      WITH input AS (
        SELECT *
        FROM jsonb_to_recordset(${input}::jsonb) as t (origin_donation_id int, origin donation_origin, author text, message text, amount float, created_at js_date)
      )
      INSERT INTO donation (origin_donation_id, origin, user_id,   author, message, amount, created_at)
      SELECT                origin_donation_id, origin, ${userId}, author, message, amount, created_at
      FROM input
      ON CONFLICT (origin_donation_id, origin) DO NOTHING
      RETURNING *
    `;

    return z.array(DonationSchema).parse(rows);
  }

  async getUsersAuthenticatedInDonationAlerts() {
    const rows = await sql`
      SELECT user_id,
        donationalerts_access_token   AS access_token,
        donationalerts_refresh_token  AS refresh_token
      FROM "user"
      WHERE donationalerts_access_token IS NOT NULL
        AND donationalerts_refresh_token IS NOT NULL
    `;

    const schema = z.object({
      userId: UserIdSchema,
      accessToken: AccessTokenSchema,
      refreshToken: RefreshTokenSchema,
    });

    return z.array(schema).parse(rows);
  }

  async setTokens(userId: UserId, refreshToken: RefreshToken, accessToken: AccessToken) {
    await sql`
      UPDATE "user" SET
        donationalerts_refresh_token = ${refreshToken},
        donationalerts_access_token = ${accessToken}
      WHERE user_id = ${userId}
    `;
  }
}
