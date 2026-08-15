import { randomUUID } from "node:crypto";

import { jsonb } from "@omnistream/packages/jsonb.js";
import { createSql } from "@omnistream/packages/pg.js";
import {
  AccessToken,
  AccessTokenSchema,
  AuthUserId,
  Donation,
  DonationSchema,
  RefreshToken,
  RefreshTokenSchema,
  UserId,
  UserIdSchema,
  UserInfoSchema,
  Video,
  VideoId,
  VideoPriority,
  VideoPrioritySchema,
  VideoSchema,
} from "@omnistream/packages/schemas.js";
import { Sql } from "postgres";
import { z } from "zod";

export class Store {
  static fromDbUrl(dbUrl: string) {
    return new Store(createSql(dbUrl));
  }

  constructor(private readonly sql: Sql) {}

  async insertDonations(userId: UserId, donations: Omit<Donation, "donationId" | "userId">[]) {
    const input = jsonb(this.sql, donations);

    const rows = await this.sql`
      WITH input AS (
        SELECT *
        FROM jsonb_to_recordset(${input}::jsonb) as t (origin_donation_id text, origin donation_origin, author text, message text, amount float, created_at js_date)
      )
      INSERT INTO donation (origin_donation_id, origin, user_id,   author, message, amount, created_at)
      SELECT                origin_donation_id, origin, ${userId}, author, message, amount, created_at
      FROM input
      ON CONFLICT (origin, origin_donation_id) DO NOTHING
      RETURNING *
    `;

    return z.array(DonationSchema).parse(rows);
  }

  async listDonations(userId: UserId) {
    const rows = await this.sql`
      SELECT *
      FROM donation
      WHERE user_id = ${userId}
    `;

    return z.array(DonationSchema).parse(rows);
  }

  async listVideos(userId: UserId): Promise<Video[]> {
    const rows = await this.sql`
      SELECT video.video_id, video.video_priority_id, video.url, video.amount, video.duration_minutes, video.watched_at, video.saved_at, video_priority.label AS priority_label, to_jsonb(donation) donation
      FROM video
      JOIN donation USING (donation_id)
      LEFT JOIN video_priority USING (video_priority_id)
      WHERE donation.user_id = ${userId}
      ORDER BY donation.created_at DESC, video.video_id DESC
    `;

    return z.array(VideoSchema).parse(rows);
  }

  async listVideoPriorities(userId: UserId): Promise<VideoPriority[]> {
    const rows = await this.sql`
      SELECT video_priority_id, label, min_price_per_minute
      FROM video_priority
      WHERE user_id = ${userId}
      ORDER BY min_price_per_minute DESC, video_priority_id ASC
    `;

    return z.array(VideoPrioritySchema).parse(rows);
  }

  async updateVideoPriority(
    userId: UserId,
    videoPriorityId: number,
    label: string,
    minPricePerMinute: number,
  ): Promise<VideoPriority | null> {
    const rows = await this.sql`
      UPDATE video_priority
      SET label = ${label}, min_price_per_minute = ${minPricePerMinute}
      WHERE user_id = ${userId}
        AND video_priority_id = ${videoPriorityId}
      RETURNING video_priority_id, label, min_price_per_minute
    `;

    return VideoPrioritySchema.nullable().parse(rows[0]);
  }

  async updateVideoStatus(
    userId: UserId,
    videoId: VideoId,
    status: { watchedAt?: Date | null; savedAt?: Date | null },
  ) {
    const rows = await this.sql`
      UPDATE video
      SET
        watched_at = CASE
          WHEN ${status.watchedAt !== undefined} THEN ${status.watchedAt ?? null}
          ELSE watched_at
        END,
        saved_at = CASE
          WHEN ${status.savedAt !== undefined} THEN ${status.savedAt ?? null}
          ELSE saved_at
        END
      FROM donation
      WHERE video.donation_id = donation.donation_id
        AND donation.user_id = ${userId}
        AND video.video_id = ${String(videoId)}
      RETURNING video.video_id, video.watched_at, video.saved_at
    `;

    return rows.length > 0;
  }

  async updateVideo(userId: UserId, videoId: VideoId, amount: number, durationMinutes: number) {
    const rows = await this.sql`
      UPDATE video
      SET amount = ${amount}, duration_minutes = ${durationMinutes}
      FROM donation
      WHERE video.donation_id = donation.donation_id
        AND donation.user_id = ${userId}
        AND video.video_id = ${String(videoId)}
      RETURNING video.video_id
    `;

    return rows.length > 0;
  }

  async setSlug(userId: UserId, slug: string) {
    const rows = await this.sql`
      UPDATE "user"
      SET slug = ${slug}
      WHERE user_id = ${userId}
        AND NOT EXISTS (
          SELECT 1
          FROM "user" AS other_user
          WHERE other_user.slug = ${slug}
            AND other_user.user_id <> ${userId}
        )
      RETURNING slug
    `;

    return rows.length > 0;
  }

  async listSharedVideos(slug: string): Promise<Video[] | null> {
    const users = await this.sql`
      SELECT 1
      FROM "user"
      WHERE slug = ${slug}
    `;

    if (users.length === 0) {
      return null;
    }

    const rows = await this.sql`
      SELECT video.video_id, video.video_priority_id, video.url, video.amount, video.duration_minutes, video.watched_at, video.saved_at, video_priority.label AS priority_label,
        to_jsonb(donation) as donation
      FROM video
      JOIN donation USING (donation_id)
      LEFT JOIN video_priority USING (video_priority_id)
      JOIN "user" ON "user".user_id = donation.user_id
      WHERE "user".slug = ${slug}
      ORDER BY donation.created_at DESC, video.video_id DESC
    `;

    return z.array(VideoSchema).parse(rows);
  }

  private async slugExists(slug: string) {
    const rows = await this.sql`
      SELECT 1 FROM "user" WHERE slug = ${slug}
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

  private async createUser(authUserId: AuthUserId, slug: string) {
    return await this.sql.begin(async (sql) => {
      const rows = await sql`
        INSERT INTO "user" (auth_user_id,  slug   )
        VALUES             (${authUserId}, ${slug})
        RETURNING user_id
      `;

      const schema = z.object({
        userId: UserIdSchema,
      });

      const userId = schema.parse(rows[0]).userId;

      await sql`
        INSERT INTO video_priority (user_id,    label,    min_price_per_minute)
        VALUES                     (${userId}, 'queue 0', 0                   ),
                                   (${userId}, 'queue 1', 50                  ),
                                   (${userId}, 'queue 2', 100                 ),
                                   (${userId}, 'queue 3', 200                 )
      `;

      return userId;
    });
  }

  async getOrCreateUserId(authUserId: AuthUserId, slug: string) {
    const userId = await this.getUserId(authUserId);
    if (userId) return userId;

    if (await this.slugExists(slug)) {
      slug = `@${randomUUID()}`;
    }

    return await this.createUser(authUserId, slug);
  }

  async getUsersAuthenticatedInDonationAlerts() {
    const rows = await this.sql`
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

  async getUserInfo(userId: UserId) {
    const rows = await this.sql`
      SELECT  user_id, slug,
              donationalerts_refresh_token IS NOT NULL  AS has_donationalerts_refresh_token,
              donationalerts_access_token  IS NOT NULL  AS has_donationalerts_access_token
      FROM "user"
      WHERE user_id = ${userId}
    `;

    return UserInfoSchema.optional().parse(rows[0]) ?? null;
  }

  async setTokens(userId: UserId, refreshToken: RefreshToken, accessToken: AccessToken) {
    await this.sql`
      UPDATE "user" SET
        donationalerts_refresh_token = ${refreshToken},
        donationalerts_access_token = ${accessToken}
      WHERE user_id = ${userId}
    `;
  }

  async getAccessToken(userId: UserId) {
    const rows = await this.sql`
      SELECT donationalerts_access_token
      FROM "user"
      WHERE user_id = ${userId}
    `;

    const schema = z.object({
      donationalertsAccessToken: AccessTokenSchema.nullable(),
    });

    return schema.parse(rows[0])?.donationalertsAccessToken;
  }

  async getRefreshToken(userId: UserId) {
    const rows = await this.sql`
      SELECT donationalerts_refresh_token
      FROM "user"
      WHERE user_id = ${userId}
    `;

    const schema = z.object({
      donationalertsRefreshToken: RefreshTokenSchema.nullable(),
    });

    return schema.parse(rows[0])?.donationalertsRefreshToken;
  }

  async disconnectDonationAlerts(userId: UserId) {
    await this.sql`
      UPDATE "user" SET
        donationalerts_refresh_token = null,
        donationalerts_access_token = null
      WHERE user_id = ${userId}
    `;
  }
}
