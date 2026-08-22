import { randomUUID } from "node:crypto";

import { jsonb } from "@coldbrew/packages/jsonb.js";
import { createSql } from "@coldbrew/packages/pg.js";
import {
  AccessToken,
  AuthUserId,
  Donation,
  DonationAlertsUserSchema,
  DonationSchema,
  RefreshToken,
  UserId,
  UserIdSchema,
  UserInfoSchema,
  VideoId,
  VideoPrioritySchema,
  VideoSchema,
} from "@coldbrew/packages/schemas.js";
import { Sql } from "postgres";
import { z } from "zod";

const DonationRowSchema = z.object({
  donationId: z.coerce.bigint(),
  source: z.literal("donationalerts"),
  sourceDonationId: z.string(),
  userId: UserIdSchema,
  author: z.string().nullable(),
  message: z.string().nullable(),
  amount: z.string(),
  currency: z.string(),
  amountInUserCurrency: z.string().nullable(),
  sourceCreatedAt: z.string(),
  occurredAt: z.coerce.date(),
});

const toDonation = (row: z.infer<typeof DonationRowSchema>) =>
  DonationSchema.parse({
    ...row,
    money: { amount: row.amount, currency: row.currency },
  });

const donationColumns = `donation_id, source, source_donation_id, user_id, author, message,
  amount::text AS amount, currency, amount_in_user_currency::text AS amount_in_user_currency,
  source_created_at, occurred_at`;

export class Store {
  static fromDbUrl(dbUrl: string) {
    return new Store(createSql(dbUrl));
  }

  constructor(private readonly sql: Sql) {}

  async insertDonations(
    userId: UserId,
    donations: readonly Omit<Donation, "donationId" | "userId">[],
  ) {
    if (donations.length === 0) return [];
    const input = jsonb(
      this.sql,
      donations.map((donation) => ({
        source: donation.source,
        sourceDonationId: donation.sourceDonationId,
        author: donation.author,
        message: donation.message,
        amount: donation.money.amount,
        currency: donation.money.currency,
        amountInUserCurrency: donation.amountInUserCurrency,
        sourceCreatedAt: donation.sourceCreatedAt,
        occurredAt: donation.occurredAt,
      })),
    );
    const rows = await this.sql`
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
      )
      SELECT source, source_donation_id, ${userId}, author, message, amount, currency,
        amount_in_user_currency, source_created_at, occurred_at
      FROM input
      ON CONFLICT (user_id, source, source_donation_id) DO NOTHING
      RETURNING ${this.sql.unsafe(donationColumns)}
    `;
    return z.array(DonationRowSchema).parse(rows).map(toDonation);
  }

  async listDonations(userId: UserId) {
    const rows = await this.sql.unsafe(
      `SELECT ${donationColumns} FROM donation WHERE user_id = $1 ORDER BY occurred_at DESC, donation_id DESC`,
      [userId],
    );
    return z.array(DonationRowSchema).parse(rows).map(toDonation);
  }

  async listVideos(userId: UserId) {
    return await this.listVideosWhere("donation.user_id = $1", [userId]);
  }

  async listVideoPriorities(userId: UserId) {
    const rows = await this.sql`
      SELECT video_priority_id, label, currency, min_price_per_minute::text AS min_price_per_minute, is_default
      FROM video_priority WHERE user_id = ${userId}
      ORDER BY min_price_per_minute DESC, video_priority_id ASC
    `;
    return z.array(VideoPrioritySchema).parse(rows);
  }

  async updateVideoPriority(
    userId: UserId,
    videoPriorityId: number,
    label: string,
    minPricePerMinute: string,
  ) {
    const rows = await this.sql`
      UPDATE video_priority SET label = ${label}, min_price_per_minute = CASE
        WHEN is_default THEN 0 ELSE ${minPricePerMinute}
      END
      WHERE user_id = ${userId} AND video_priority_id = ${videoPriorityId}
      RETURNING video_priority_id, label, currency, min_price_per_minute::text AS min_price_per_minute, is_default
    `;
    return VideoPrioritySchema.nullable().parse(rows[0] ?? null);
  }

  async updateVideoStatus(
    userId: UserId,
    videoId: VideoId,
    status: { watchedAt?: Date | null; savedAt?: Date | null },
  ) {
    const rows = await this.sql`
      UPDATE video SET
        watched_at = CASE WHEN ${status.watchedAt !== undefined} THEN ${status.watchedAt ?? null} ELSE watched_at END,
        saved_at = CASE WHEN ${status.savedAt !== undefined} THEN ${status.savedAt ?? null} ELSE saved_at END
      FROM donation
      WHERE video.donation_id = donation.donation_id AND donation.user_id = ${userId}
        AND video.video_id = ${String(videoId)}
      RETURNING video.video_id
    `;
    return rows.length > 0;
  }

  async updateVideo(
    userId: UserId,
    videoId: VideoId,
    queueAmount: string,
    durationMinutes: number,
  ) {
    const rows = await this.sql`
      UPDATE video SET queue_amount = ${queueAmount}, duration_minutes = ${durationMinutes}
      FROM donation
      WHERE video.donation_id = donation.donation_id AND donation.user_id = ${userId}
        AND video.video_id = ${String(videoId)}
      RETURNING video.video_id
    `;
    return rows.length > 0;
  }

  async setSlug(userId: UserId, slug: string) {
    const rows = await this.sql`
      UPDATE "user" SET slug = ${slug}
      WHERE user_id = ${userId} AND NOT EXISTS (
        SELECT 1 FROM "user" other WHERE other.slug = ${slug} AND other.user_id <> ${userId}
      ) RETURNING slug
    `;
    return rows.length > 0;
  }

  async listSharedVideos(slug: string) {
    const users = await this.sql`SELECT 1 FROM "user" WHERE slug = ${slug}`;
    return users.length === 0 ? null : await this.listVideosWhere('"user".slug = $1', [slug], true);
  }

  private async listVideosWhere(where: string, values: (string | number)[], joinUser = false) {
    const rows = await this.sql.unsafe(
      `SELECT video.video_id, video.video_priority_id, video.provider, video.provider_video_id, video.url,
        video.queue_amount::text AS queue_amount, video.queue_currency, video.duration_minutes,
        video.watched_at, video.saved_at, video_priority.label AS priority_label,
        jsonb_build_object('donationId', donation.donation_id::text, 'source', donation.source,
          'sourceDonationId', donation.source_donation_id, 'userId', donation.user_id,
          'author', donation.author, 'message', donation.message, 'amount', donation.amount::text,
          'currency', donation.currency, 'amountInUserCurrency', donation.amount_in_user_currency::text,
          'sourceCreatedAt', donation.source_created_at, 'occurredAt', donation.occurred_at) AS donation
       FROM video JOIN donation USING (donation_id)
       LEFT JOIN video_priority USING (video_priority_id)
       ${joinUser ? 'JOIN "user" ON "user".user_id = donation.user_id' : ""}
       WHERE ${where} ORDER BY donation.occurred_at DESC, video.video_id DESC`,
      values,
    );
    const rowSchema = z.object({
      videoId: z.coerce.bigint(),
      videoPriorityId: z.number().nullable(),
      provider: z.literal("youtube"),
      providerVideoId: z.string(),
      url: z.url(),
      queueAmount: z.string().nullable(),
      queueCurrency: z.string(),
      durationMinutes: z.number().int().positive(),
      priorityLabel: z.string().nullable(),
      watchedAt: z.coerce.date().nullable(),
      savedAt: z.coerce.date().nullable(),
      donation: DonationRowSchema,
    });
    return z
      .array(rowSchema)
      .parse(rows)
      .map((row) =>
        VideoSchema.parse({
          ...row,
          queueMoney:
            row.queueAmount === null
              ? null
              : { amount: row.queueAmount, currency: row.queueCurrency },
          donation: toDonation(row.donation),
        }),
      );
  }

  private async getUserId(authUserId: AuthUserId) {
    const rows = await this.sql`SELECT user_id FROM "user" WHERE auth_user_id = ${authUserId}`;
    return (
      z
        .object({ userId: UserIdSchema })
        .nullable()
        .parse(rows[0] ?? null)?.userId ?? null
    );
  }

  async getOrCreateUserId(authUserId: AuthUserId, preferredSlug: string): Promise<UserId> {
    const existing = await this.getUserId(authUserId);
    if (existing) return existing;
    return await this.sql
      .begin(async (sql) => {
        const rows = await sql`
        INSERT INTO "user" (auth_user_id, slug) VALUES (${authUserId}, ${preferredSlug})
        ON CONFLICT (auth_user_id) DO UPDATE SET auth_user_id = EXCLUDED.auth_user_id
        RETURNING user_id
      `;
        const userId = z.object({ userId: UserIdSchema }).parse(rows[0]).userId;
        await sql`
        INSERT INTO video_priority (user_id, currency, label, min_price_per_minute, is_default) VALUES
          (${userId}, 'RUB', 'queue 0', 0, true), (${userId}, 'RUB', 'queue 1', 50, false),
          (${userId}, 'RUB', 'queue 2', 100, false), (${userId}, 'RUB', 'queue 3', 200, false)
        ON CONFLICT DO NOTHING
      `;
        return userId;
      })
      .catch(async () => await this.getOrCreateUserId(authUserId, `@${randomUUID()}`));
  }

  async getUsersAuthenticatedInDonationAlerts() {
    const rows = await this.sql`
      SELECT user_id, source_user_id, access_token, refresh_token, token_version, history_checkpoint
      FROM donationalerts_connection ORDER BY user_id
    `;
    return z.array(DonationAlertsUserSchema).parse(rows);
  }

  async getUserInfo(userId: UserId) {
    const rows = await this.sql`
      SELECT "user".user_id, "user".slug, "user".queue_currency,
        donationalerts_connection.user_id IS NOT NULL AS has_donation_alerts_connection
      FROM "user" LEFT JOIN donationalerts_connection USING (user_id) WHERE "user".user_id = ${userId}
    `;
    return UserInfoSchema.nullable().parse(rows[0] ?? null);
  }

  async saveDonationAlertsConnection(
    userId: UserId,
    connection: { sourceUserId: string; accessToken: AccessToken; refreshToken: RefreshToken },
  ) {
    await this.sql`
      INSERT INTO donationalerts_connection (user_id, source_user_id, access_token, refresh_token)
      VALUES (${userId}, ${connection.sourceUserId}, ${connection.accessToken}, ${connection.refreshToken})
      ON CONFLICT (user_id) DO UPDATE SET source_user_id = EXCLUDED.source_user_id,
        access_token = EXCLUDED.access_token, refresh_token = EXCLUDED.refresh_token,
        token_version = donationalerts_connection.token_version + 1, updated_at = now()
    `;
  }

  async setTokens(userId: UserId, refreshToken: RefreshToken, accessToken: AccessToken) {
    await this.sql`
      UPDATE donationalerts_connection SET
      refresh_token = ${refreshToken},
      access_token = ${accessToken},
      token_version = token_version + 1,
      updated_at = now()
      WHERE user_id = ${userId}
    `;
  }

  async disconnectDonationAlerts(userId: UserId) {
    await this.sql`
      DELETE FROM donationalerts_connection
      WHERE user_id = ${userId}
    `;
  }
}
