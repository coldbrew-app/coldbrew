import { jsonb } from "@omnistream/packages/jsonb.js";
import {
  Donation,
  DonationSchema,
  UserId,
  VideoPrioritySchema,
} from "@omnistream/packages/schemas.js";
import postgres, { Sql } from "postgres";
import { z } from "zod";

export type VideoToSave = {
  durationSeconds: number | null;
  url: string;
  videoPriorityId: number | null;
};

export class Store {
  static fromDbUrl(dbUrl: string) {
    return new Store(postgres(dbUrl, { transform: postgres.camel }));
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

  async getVideoPriorities(userId: UserId) {
    const rows = await this.sql`
      SELECT *
      FROM video_priority
      WHERE user_id = ${userId}
      ORDER BY min_price_per_minute DESC
    `;

    return z.array(VideoPrioritySchema).parse(rows);
  }

  async saveVideos({ donationId }: Donation, videos: readonly VideoToSave[]) {
    await this.sql.begin(async (sql) => {
      if (videos.length > 0) {
        await sql`
          WITH input AS (
            SELECT *
            FROM jsonb_to_recordset(${jsonb(sql, videos)}::jsonb) as t (url text, duration_seconds int, video_priority_id int)
          )
          INSERT INTO video (donation_id, url, duration_seconds, video_priority_id)
          SELECT           ${donationId}, url, duration_seconds, video_priority_id
          FROM input
          ON CONFLICT (donation_id, url) DO NOTHING
        `;
      }

      await sql`
        UPDATE donation
        SET videos_parsed_at = now()
        WHERE donation_id = ${donationId}
      `;
    });
  }
}
