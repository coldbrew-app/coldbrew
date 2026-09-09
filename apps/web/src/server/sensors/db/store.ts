import { randomUUID } from "node:crypto";

import {
  DonationSchema,
  DonationIdSchema,
  VideoIdSchema,
  MoneyAmountSchema,
  QueueCurrencySchema,
  type DonationId,
  PublicQueueSettingsSchema,
  SlugSchema,
  UserIdSchema,
  UserInfoSchema,
  type AuthUserId,
  type PublicQueueSettings,
  type Slug,
  type UserId,
} from "@coldbrew/packages/schemas.js";
import type { Sql } from "postgres";
import { z } from "zod";

function isUserSlugConflict(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505" &&
    "constraint_name" in error &&
    error.constraint_name === "user_slug_key"
  );
}

export class Store {
  constructor(private readonly sql: Sql) {}

  async listDonationsPage(
    userId: UserId,
    input: {
      page: number;
      pageSize: number;
      query: string;
      occurredAfter: Date | null;
      donationId?: DonationId;
    },
  ) {
    const focusedDonationId = input.donationId?.toString() ?? null;
    const searchPattern = `%${input.query}%`;
    const countRows = await this.sql`
      SELECT count(*)::int AS total
      FROM donation
      WHERE user_id = ${userId}
        AND (${focusedDonationId}::bigint IS NULL OR donation_id = ${focusedDonationId})
        AND (${input.occurredAfter}::timestamptz IS NULL OR occurred_at >= ${input.occurredAfter})
        AND (
          ${input.query} = ''
          OR coalesce(author, '') ILIKE ${searchPattern}
          OR coalesce(message, '') ILIKE ${searchPattern}
        )
    `;
    const countSchema = z.object({
      total: z.int().nonnegative(),
    });
    const total = countSchema.parse(countRows[0]).total;
    const totalPages = Math.ceil(total / input.pageSize);
    const page = Math.min(input.page, Math.max(totalPages, 1));
    const offset = (page - 1) * input.pageSize;
    const rows = await this.sql`
      SELECT *
      FROM donation
      WHERE user_id = ${userId}
        AND (${focusedDonationId}::bigint IS NULL OR donation_id = ${focusedDonationId})
        AND (${input.occurredAfter}::timestamptz IS NULL OR occurred_at >= ${input.occurredAfter})
        AND (
          ${input.query} = ''
          OR coalesce(author, '') ILIKE ${searchPattern}
          OR coalesce(message, '') ILIKE ${searchPattern}
        )
      ORDER BY occurred_at DESC, donation_id DESC
      LIMIT ${input.pageSize}
      OFFSET ${offset}
    `;
    const donationSchema = DonationSchema.extend({
      videosParsedAt: z.coerce.date().nullable(),
    });
    const donations = z.array(donationSchema).parse(rows);
    const videoRows =
      donations.length === 0
        ? []
        : await this.sql`
      SELECT
        video.donation_id,
        video.video_id,
        video.url,
        video.title,
        video.start_seconds,
        video.end_seconds,
        video.queue_amount,
        video.watched_at,
        video.bookmarked_at,
        "user".queue_currency,
        video_priority.label AS priority_label
      FROM video
      JOIN donation USING (donation_id)
      JOIN "user" ON "user".user_id = donation.user_id
      LEFT JOIN video_priority USING (video_priority_id)
      WHERE donation.user_id = ${userId}
        AND donation.donation_id = ANY(${donations.map((donation) => donation.donationId.toString())}::bigint[])
      ORDER BY video.video_id
    `;
    const videoSchema = z.object({
      donationId: DonationIdSchema,
      videoId: VideoIdSchema,
      url: z.url(),
      title: z.string().trim().min(1).nullable(),
      startSeconds: z.int().nonnegative(),
      endSeconds: z.int().positive().nullable(),
      queueAmount: MoneyAmountSchema.nullable(),
      queueCurrency: QueueCurrencySchema,
      priorityLabel: z.string().nullable(),
      watchedAt: z.coerce.date().nullable(),
      bookmarkedAt: z.coerce.date().nullable(),
    });
    const videos = z.array(videoSchema).parse(videoRows);
    return {
      items: donations.map((donation) => ({
        ...donation,
        videos: videos.filter((video) => video.donationId === donation.donationId),
      })),
      page,
      pageSize: input.pageSize,
      total,
      totalPages,
    };
  }

  async getDonationOverview(userId: UserId) {
    const [summaryRows, recentRows] = await Promise.all([
      this.sql`
        SELECT
          count(*)::int AS donation_count,
          coalesce(sum(amount), 0) AS total_amount
        FROM donation
        WHERE user_id = ${userId}
      `,
      this.sql`
        SELECT *
        FROM donation
        WHERE user_id = ${userId}
        ORDER BY occurred_at DESC, donation_id DESC
        LIMIT 3
      `,
    ]);
    const schema = z.object({
      donationCount: z.int().nonnegative(),
      totalAmount: z.coerce.number(),
    });
    const summary = schema.parse(summaryRows[0]);
    return { ...summary, recentDonations: z.array(DonationSchema).parse(recentRows) };
  }

  async setSlug(userId: UserId, slug: Slug) {
    const rows = await this.sql`
      UPDATE "user"
      SET slug = ${slug}
      WHERE user_id = ${userId}
        AND NOT EXISTS (
          SELECT 1
          FROM "user" other
          WHERE other.slug = ${slug}
            AND other.user_id <> ${userId}
        )
      RETURNING slug
    `;
    return rows.length > 0;
  }

  private async getUserId(authUserId: AuthUserId) {
    const rows = await this.sql`
      SELECT user_id
      FROM "user"
      WHERE auth_user_id = ${authUserId}
    `;
    const schema = z.object({
      userId: UserIdSchema,
    });

    return schema.optional().parse(rows[0])?.userId ?? null;
  }

  async getOrCreateUserId(authUserId: AuthUserId, preferredSlug: Slug): Promise<UserId> {
    const existing = await this.getUserId(authUserId);
    if (existing) {
      return existing;
    }
    let slug = preferredSlug;
    while (true) {
      try {
        return await this.sql.begin(async (sql) => {
          const rows = await sql`
            INSERT INTO "user" (auth_user_id, slug)
            VALUES (${authUserId}, ${slug})
            ON CONFLICT (auth_user_id) DO UPDATE
            SET auth_user_id = EXCLUDED.auth_user_id
            RETURNING user_id
          `;
          const schema = z.object({
            userId: UserIdSchema,
          });
          const userId = schema.parse(rows[0]).userId;
          await sql`
            INSERT INTO video_queue (user_id, label, is_default)
            VALUES (${userId}, 'Main', true)
            ON CONFLICT (user_id) WHERE is_default DO UPDATE SET user_id = EXCLUDED.user_id
          `;
          await sql`
            INSERT INTO video_priority (user_id, label, min_price_per_minute, is_default)
            VALUES
              (${userId}, 'queue 0', 0, true),
              (${userId}, 'queue 1', 50, false),
              (${userId}, 'queue 2', 100, false),
              (${userId}, 'queue 3', 200, false)
            ON CONFLICT DO NOTHING
          `;
          return userId;
        });
      } catch (error) {
        if (!isUserSlugConflict(error)) {
          throw error;
        }
        slug = SlugSchema.parse(randomUUID());
      }
    }
  }

  async getUserInfo(userId: UserId) {
    const rows = await this.sql`
      SELECT
        "user".user_id,
        "user".slug,
        "user".queue_currency,
        donationalerts_connection.user_id IS NOT NULL AS has_donation_alerts_connection,
        jsonb_build_object(
          'enabled',           "user".public_queue_enabled,
          'showAmounts',       "user".public_queue_show_amounts,
          'showWatchedVideos', "user".public_queue_show_watched
        ) AS public_queue_settings
      FROM "user"
      LEFT JOIN donationalerts_connection USING (user_id)
      WHERE "user".user_id = ${userId}
    `;
    return UserInfoSchema.optional().parse(rows[0]) ?? null;
  }

  async setPublicQueueSettings(userId: UserId, settings: PublicQueueSettings) {
    const rows = await this.sql`
      UPDATE "user"
      SET
        public_queue_enabled = ${settings.enabled},
        public_queue_show_amounts = ${settings.showAmounts},
        public_queue_show_watched = ${settings.showWatchedVideos}
      WHERE user_id = ${userId}
      RETURNING jsonb_build_object(
        'enabled',           public_queue_enabled,
        'showAmounts',       public_queue_show_amounts,
        'showWatchedVideos', public_queue_show_watched
      ) AS public_queue_settings
    `;
    const schema = z.object({
      publicQueueSettings: PublicQueueSettingsSchema,
    });

    return schema.parse(rows[0]).publicQueueSettings;
  }
}
