import { jsonb } from "@coldbrew/packages/jsonb.js";
import { createSql } from "@coldbrew/packages/pg.js";
import {
  Donation,
  DonationSchema,
  MoneyAmount,
  QueueCurrencySchema,
} from "@coldbrew/packages/schemas.js";
import { Sql } from "postgres";
import { z } from "zod";

export type VideoToSave = {
  provider: "youtube";
  providerVideoId: string;
  url: string;
  queueAmount: MoneyAmount | null;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
};

export class Store {
  static fromDbUrl(dbUrl: string) {
    return new Store(createSql(dbUrl));
  }

  constructor(private readonly sql: Sql) {}

  async getUnparsedDonations(limit = 100) {
    const rows = await this.sql`
      SELECT
        donation_id,
        source,
        source_donation_id,
        donation.user_id,
        author,
        message,
        amount,
        currency,
        source_created_at,
        occurred_at,
        "user".queue_currency
      FROM donation
      JOIN "user" USING (user_id)
      WHERE videos_parsed_at IS NULL
      ORDER BY occurred_at ASC
      LIMIT ${limit}
    `;
    const schema = DonationSchema.extend({
      queueCurrency: QueueCurrencySchema,
    });

    return z.array(schema).parse(rows);
  }

  async setDonationParsed({ donationId }: Donation, videos: readonly VideoToSave[]) {
    await this.sql.begin(async (sql) => {
      await sql`
        UPDATE donation
        SET videos_parsed_at = now()
        WHERE donation_id = ${String(donationId)}
      `;
      if (videos.length === 0) return;
      await sql`
        WITH input AS (
          SELECT *
          FROM jsonb_to_recordset(${jsonb(sql, videos)}::jsonb) AS t (
            provider video_provider,
            provider_video_id text,
            url text,
            queue_amount money_amount,
            start_seconds nonnegative_int,
            end_seconds positive_int,
            duration_seconds positive_int
          )
        )
        INSERT INTO video (
          donation_id,
          provider,
          provider_video_id,
          url,
          queue_amount,
          start_seconds,
          end_seconds,
          duration_seconds
        )
        SELECT
          ${String(donationId)},
          provider,
          provider_video_id,
          url,
          queue_amount,
          start_seconds,
          end_seconds,
          duration_seconds
        FROM input
        ON CONFLICT (donation_id, provider, provider_video_id) DO NOTHING
      `;
    });
  }
}
