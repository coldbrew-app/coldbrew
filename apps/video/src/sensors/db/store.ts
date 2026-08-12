import { jsonb } from "@omnistream/packages/jsonb.js";
import { createSql } from "@omnistream/packages/pg.js";
import { Donation, DonationSchema } from "@omnistream/packages/schemas.js";
import { Sql } from "postgres";
import { z } from "zod";

export type VideoToSave = {
  amount: number;
  durationSeconds: number | null;
  url: string;
};

export class Store {
  static fromDbUrl(dbUrl: string) {
    return new Store(createSql(dbUrl));
  }

  constructor(private readonly sql: Sql) {}

  async getUnparsedDonations(limit = 100) {
    const rows = await this.sql`
      SELECT *
      FROM donation
      WHERE videos_parsed_at IS NULL
      ORDER BY created_at ASC
      LIMIT ${limit}
    `;

    return z.array(DonationSchema).parse(rows);
  }

  async setDonationParsed({ donationId }: Donation, videos: readonly VideoToSave[]) {
    await this.sql.begin(async (sql) => {
      await sql`
        UPDATE donation
        SET videos_parsed_at = now()
        WHERE donation_id = ${String(donationId)}
      `;

      if (videos.length > 0) {
        await sql`
          WITH input AS (
            SELECT *
            FROM jsonb_to_recordset(${jsonb(sql, videos)}::jsonb) as t (url text, amount float, duration_seconds int)
          )
          INSERT INTO video (donation_id,         url, amount, duration_seconds)
          SELECT           ${String(donationId)}, url, amount, duration_seconds
          FROM input
          ON CONFLICT (donation_id, url) DO NOTHING
        `;
      }
    });
  }
}
