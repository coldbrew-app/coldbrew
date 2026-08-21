import { jsonb } from "@coldbrew/packages/jsonb.js";
import { createSql } from "@coldbrew/packages/pg.js";
import {
  CurrencyCode,
  CurrencyCodeSchema,
  Donation,
  DonationSchema,
  MoneyAmount,
  MoneyAmountSchema,
} from "@coldbrew/packages/schemas.js";
import { Sql } from "postgres";
import { z } from "zod";

export type VideoToSave = {
  provider: "youtube";
  providerVideoId: string;
  url: string;
  queueAmount: MoneyAmount | null;
  queueCurrency: CurrencyCode;
  durationMinutes: number;
};

const JobSchema = z.object({
  donationId: z.coerce.bigint(),
  source: z.literal("donationalerts"),
  sourceDonationId: z.string(),
  userId: z.number(),
  author: z.string().nullable(),
  message: z.string().nullable(),
  amount: MoneyAmountSchema,
  currency: CurrencyCodeSchema,
  amountInUserCurrency: MoneyAmountSchema.nullable(),
  sourceCreatedAt: z.string(),
  occurredAt: z.coerce.date(),
  queueCurrency: CurrencyCodeSchema,
});

export class Store {
  static fromDbUrl(dbUrl: string) {
    return new Store(createSql(dbUrl));
  }

  constructor(private readonly sql: Sql) {}

  async getUnparsedDonations(limit = 100) {
    const rows = await this.sql`
      SELECT donation_id, source, source_donation_id, donation.user_id, author, message,
        amount::text AS amount, currency, amount_in_user_currency::text AS amount_in_user_currency,
        source_created_at, occurred_at, "user".queue_currency
      FROM donation JOIN "user" USING (user_id)
      WHERE videos_parsed_at IS NULL ORDER BY occurred_at ASC LIMIT ${limit}
    `;
    return z
      .array(JobSchema)
      .parse(rows)
      .map((row) => ({
        ...DonationSchema.parse({ ...row, money: { amount: row.amount, currency: row.currency } }),
        queueCurrency: row.queueCurrency,
      }));
  }

  async setDonationParsed({ donationId }: Donation, videos: readonly VideoToSave[]) {
    await this.sql.begin(async (sql) => {
      await sql`UPDATE donation SET videos_parsed_at = now() WHERE donation_id = ${String(donationId)}`;
      if (videos.length === 0) return;
      await sql`
        WITH input AS (
          SELECT * FROM jsonb_to_recordset(${jsonb(sql, videos)}::jsonb) AS t (
            provider video_provider, provider_video_id text, url text, queue_amount money_amount,
            queue_currency currency_code, duration_minutes positive_int
          )
        ) INSERT INTO video (donation_id, provider, provider_video_id, url, queue_amount, queue_currency, duration_minutes)
        SELECT ${String(donationId)}, provider, provider_video_id, url, queue_amount, queue_currency, duration_minutes FROM input
        ON CONFLICT (donation_id, provider, provider_video_id) DO NOTHING
      `;
    });
  }
}
