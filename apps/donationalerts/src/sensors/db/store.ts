import { jsonb } from "@coldbrew/packages/jsonb.js";
import { createSql } from "@coldbrew/packages/pg.js";
import {
  AccessToken,
  Donation,
  DonationAlertsUserSchema,
  DonationSchema,
  RefreshToken,
  UserId,
} from "@coldbrew/packages/schemas.js";
import { z } from "zod";

import { env } from "../../env.js";

const sql = createSql(env.DATABASE_URL);

export class Store {
  async insertDonations(
    userId: UserId,
    donations: readonly Omit<Donation, "donationId" | "userId">[],
  ) {
    if (donations.length === 0) return [];
    const input = jsonb(
      sql,
      donations.map((donation) => ({ ...donation, ...donation.money })),
    );

    const rows = await sql`
      WITH input AS (
        SELECT * FROM jsonb_to_recordset(${input}::jsonb) AS t (
          source donation_source, source_donation_id text, author text, message text,
          amount money_amount, currency currency_code, amount_in_user_currency money_amount,
          source_created_at text, occurred_at js_date
        )
      )
      INSERT INTO donation (
        source, source_donation_id, user_id, author, message, amount, currency,
        amount_in_user_currency, source_created_at, occurred_at
      ) SELECT source, source_donation_id, ${userId}, author, message, amount, currency,
        amount_in_user_currency, source_created_at, occurred_at FROM input
      ON CONFLICT (user_id, source, source_donation_id) DO NOTHING
      RETURNING *, jsonb_build_object('amount', amount::text, 'currency', currency) as money
    `;

    return z.array(DonationSchema).parse(rows);
  }

  async getUsersAuthenticatedInDonationAlerts() {
    const rows = await sql`
      SELECT user_id, source_user_id, access_token, refresh_token, token_version, history_checkpoint
      FROM donationalerts_connection ORDER BY user_id
    `;
    return z.array(DonationAlertsUserSchema).parse(rows);
  }

  async setTokens(userId: UserId, refreshToken: RefreshToken, accessToken: AccessToken) {
    await sql`UPDATE donationalerts_connection SET refresh_token = ${refreshToken}, access_token = ${accessToken}, token_version = token_version + 1, updated_at = now() WHERE user_id = ${userId}`;
  }
}
