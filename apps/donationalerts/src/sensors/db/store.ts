import { jsonb } from "@coldbrew/packages/jsonb.js";
import { createSql } from "@coldbrew/packages/pg.js";
import {
  DonationAlertsUserSchema,
  DonationSchema,
  type AccessToken,
  type Donation,
  type RefreshToken,
  type UserId,
} from "@coldbrew/packages/schemas.js";
import { z } from "zod";

import { env } from "../../env.js";

const sql = createSql(env.DATABASE_URL);

export class Store {
  async insertDonations(
    userId: UserId,
    donations: readonly Omit<Donation, "donationId" | "userId">[],
  ) {
    if (donations.length === 0) {
      return [];
    }
    return await sql.begin(async (tx) => {
      const input = jsonb(tx, donations);

      const rows = await tx`
      WITH input AS (
        SELECT *
        FROM jsonb_to_recordset(${input}::jsonb) AS t (
          source donation_source,
          source_donation_id text,
          author text,
          message text,
          amount money_amount,
          currency currency_code,
          source_created_at text,
          occurred_at js_date
        )
      )
      INSERT INTO donation (
        source,
        source_donation_id,
        user_id,
        author,
        message,
        amount,
        currency,
        source_created_at,
        occurred_at
      )
      SELECT
        source,
        source_donation_id,
        ${userId},
        author,
        message,
        amount,
        currency,
        source_created_at,
        occurred_at
      FROM input
      ON CONFLICT (user_id, source, source_donation_id) DO NOTHING
      RETURNING *
    `;

      return z.array(DonationSchema).parse(rows);
    });
  }

  async getUsersAuthenticatedInDonationAlerts() {
    const rows = await sql`
      SELECT
        user_id,
        source_user_id,
        access_token,
        refresh_token,
        token_version,
        history_checkpoint
      FROM donationalerts_connection
      ORDER BY user_id
    `;
    return z.array(DonationAlertsUserSchema).parse(rows);
  }

  async setTokens(
    userId: UserId,
    tokenVersion: number,
    refreshToken: RefreshToken,
    accessToken: AccessToken,
  ) {
    const rows = await sql`
      UPDATE donationalerts_connection
      SET
        refresh_token = ${refreshToken},
        access_token = ${accessToken},
        token_version = token_version + 1,
        updated_at = now()
      WHERE user_id = ${userId} AND token_version = ${tokenVersion}
      RETURNING token_version
    `;
    return z.array(z.object({ tokenVersion: z.int().positive() })).parse(rows).length === 1;
  }

  async disconnectDonationAlerts(userId: UserId) {
    await sql`
      DELETE FROM donationalerts_connection
      WHERE user_id = ${userId}
    `;
  }
}
