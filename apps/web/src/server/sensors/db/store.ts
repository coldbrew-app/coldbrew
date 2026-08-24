import { randomUUID } from "node:crypto";

import { conversionFactorForCurrencyChange } from "@coldbrew/packages/currency.js";
import { jsonb } from "@coldbrew/packages/jsonb.js";
import { createSql } from "@coldbrew/packages/pg.js";
import {
  AccessToken,
  AuthUserId,
  Donation,
  DonationAlertsUserSchema,
  DonationSchema,
  MoneyAmount,
  QueueCurrencySchema,
  QueueCurrency,
  RefreshToken,
  UserId,
  UserIdSchema,
  UserInfoSchema,
  VideoId,
  VideoIdSchema,
  VideoPrioritySchema,
  VideoSchema,
} from "@coldbrew/packages/schemas.js";
import { Sql } from "postgres";
import { z } from "zod";

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
    return await this.sql.begin(async (sql) => {
      const input = jsonb(sql, donations);
      const rows = await sql`
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

  async listDonationsPage(
    userId: UserId,
    input: { page: number; pageSize: number; query: string; occurredAfter: Date | null },
  ) {
    const searchPattern = `%${input.query}%`;
    const countRows = await this.sql`
      SELECT count(*)::int AS total
      FROM donation
      WHERE user_id = ${userId}
        AND (${input.occurredAfter}::timestamptz IS NULL OR occurred_at >= ${input.occurredAfter})
        AND (
          ${input.query} = ''
          OR coalesce(author, '') ILIKE ${searchPattern}
          OR coalesce(message, '') ILIKE ${searchPattern}
        )
    `;
    const total = z
      .object({
        total: z.number().int().nonnegative(),
      })
      .parse(countRows[0]).total;
    const totalPages = Math.ceil(total / input.pageSize);
    const page = Math.min(input.page, Math.max(totalPages, 1));
    const offset = (page - 1) * input.pageSize;
    const rows = await this.sql`
      SELECT *
      FROM donation
      WHERE user_id = ${userId}
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
    return {
      items: z.array(DonationSchema).parse(rows),
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
    const summary = z
      .object({ donationCount: z.number().int().nonnegative(), totalAmount: z.coerce.number() })
      .parse(summaryRows[0]);
    return { ...summary, recentDonations: z.array(DonationSchema).parse(recentRows) };
  }

  async listVideosPage(
    userId: UserId,
    input: {
      page: number;
      pageSize: number;
      videoPriorityId: number | null;
      videoStatus: "all" | "notwatched" | "watched" | "saved";
    },
  ) {
    const [countRows, statusCountRows, priorityCountRows] = await Promise.all([
      this.sql`
        SELECT count(*)::int AS total
        FROM video
        LEFT JOIN donation USING (donation_id)
        WHERE coalesce(video.user_id, donation.user_id) = ${userId}
          AND (${input.videoPriorityId}::int IS NULL OR video.video_priority_id = ${input.videoPriorityId})
          AND (
            ${input.videoStatus} = 'all'
            OR (${input.videoStatus} = 'notwatched' AND video.watched_at IS NULL)
            OR (${input.videoStatus} = 'watched' AND video.watched_at IS NOT NULL)
            OR (${input.videoStatus} = 'saved' AND video.saved_at IS NOT NULL)
          )
      `,
      this.sql`
        SELECT
          count(*)::int AS all,
          count(*) FILTER (WHERE video.watched_at IS NULL)::int AS notwatched,
          count(*) FILTER (WHERE video.watched_at IS NOT NULL)::int AS watched,
          count(*) FILTER (WHERE video.saved_at IS NOT NULL)::int AS saved
        FROM video
        LEFT JOIN donation USING (donation_id)
        WHERE coalesce(video.user_id, donation.user_id) = ${userId}
      `,
      this.sql`
        SELECT video.video_priority_id, count(*)::int AS count
        FROM video
        LEFT JOIN donation USING (donation_id)
        WHERE coalesce(video.user_id, donation.user_id) = ${userId}
          AND video.video_priority_id IS NOT NULL
          AND (
            ${input.videoStatus} = 'all'
            OR (${input.videoStatus} = 'notwatched' AND video.watched_at IS NULL)
            OR (${input.videoStatus} = 'watched' AND video.watched_at IS NOT NULL)
            OR (${input.videoStatus} = 'saved' AND video.saved_at IS NOT NULL)
          )
        GROUP BY video.video_priority_id
      `,
    ]);
    const total = z
      .object({
        total: z.number().int().nonnegative(),
      })
      .parse(countRows[0]).total;
    const totalPages = Math.ceil(total / input.pageSize);
    const page = Math.min(input.page, Math.max(totalPages, 1));
    const offset = (page - 1) * input.pageSize;
    const rows = await this.sql`
      SELECT
        video.video_id,
        video.video_priority_id,
        video.provider,
        video.provider_video_id,
        video.url,
        video.start_seconds,
        video.end_seconds,
        video.watched_at,
        video.saved_at,
        video_priority.label AS priority_label,
        video.queue_amount,
        "user".queue_currency,
        CASE
          WHEN donation.donation_id IS NULL THEN 'manual'
          ELSE 'donation'
        END AS source,
        coalesce(donation.occurred_at, video.added_at) AS created_at,
        CASE
          WHEN donation.donation_id IS NULL THEN NULL
          ELSE jsonb_build_object(
            'donationId',            donation.donation_id::text,
            'source',                donation.source,
            'sourceDonationId',      donation.source_donation_id,
            'userId',                donation.user_id,
            'author',                donation.author,
            'message',               donation.message,
            'amount',                donation.amount,
            'currency',              donation.currency,
            'sourceCreatedAt',       donation.source_created_at,
            'occurredAt',            donation.occurred_at
          )
        END AS donation
      FROM video
      LEFT JOIN donation USING (donation_id)
      JOIN "user"
        ON "user".user_id = coalesce(video.user_id, donation.user_id)
      LEFT JOIN video_priority USING (video_priority_id)
      WHERE "user".user_id = ${userId}
        AND (${input.videoPriorityId}::int IS NULL OR video.video_priority_id = ${input.videoPriorityId})
        AND (
          ${input.videoStatus} = 'all'
          OR (${input.videoStatus} = 'notwatched' AND video.watched_at IS NULL)
          OR (${input.videoStatus} = 'watched' AND video.watched_at IS NOT NULL)
          OR (${input.videoStatus} = 'saved' AND video.saved_at IS NOT NULL)
        )
      ORDER BY
        CASE
          WHEN ${input.videoStatus} = 'watched' THEN video.watched_at
          WHEN ${input.videoStatus} = 'saved' THEN video.saved_at
          ELSE coalesce(donation.occurred_at, video.added_at)
        END DESC,
        video.video_id DESC
      LIMIT ${input.pageSize}
      OFFSET ${offset}
    `;
    const statusCounts = z
      .object({
        all: z.number().int().nonnegative(),
        notwatched: z.number().int().nonnegative(),
        watched: z.number().int().nonnegative(),
        saved: z.number().int().nonnegative(),
      })
      .parse(statusCountRows[0]);
    const priorityCounts = Object.fromEntries(
      z
        .array(
          z.object({
            videoPriorityId: z.number().int().positive(),
            count: z.number().int().nonnegative(),
          }),
        )
        .parse(priorityCountRows)
        .map(({ videoPriorityId, count }) => [videoPriorityId, count]),
    );
    return {
      items: z.array(VideoSchema).parse(rows),
      page,
      pageSize: input.pageSize,
      priorityCounts,
      statusCounts,
      total,
      totalPages,
    };
  }

  async addManualVideo(
    userId: UserId,
    input: {
      providerVideoId: string;
      url: string;
      queueAmount: MoneyAmount;
      startSeconds: number;
      endSeconds: number;
    },
  ) {
    const rows = await this.sql`
      INSERT INTO video (
        user_id,
        added_at,
        provider,
        provider_video_id,
        url,
        queue_amount,
        start_seconds,
        end_seconds
      )
      VALUES (
        ${userId},
        now(),
        'youtube',
        ${input.providerVideoId},
        ${input.url},
        ${input.queueAmount},
        ${input.startSeconds},
        ${input.endSeconds}
      )
      RETURNING video_id
    `;
    return VideoIdSchema.parse(rows[0]?.videoId);
  }

  async listVideoPriorities(userId: UserId) {
    const rows = await this.sql`
      SELECT video_priority_id, label, is_default,
        min_price_per_minute
      FROM video_priority
      WHERE user_id = ${userId}
      ORDER BY video_priority.min_price_per_minute DESC, video_priority_id ASC
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
      UPDATE video_priority
      SET
        label = ${label},
        min_price_per_minute = CASE WHEN is_default THEN 0 ELSE ${minPricePerMinute} END
      WHERE user_id = ${userId}
        AND video_priority_id = ${videoPriorityId}
      RETURNING video_priority_id, label, is_default,
        min_price_per_minute
    `;
    return VideoPrioritySchema.nullable().parse(rows[0] ?? null);
  }

  async updateVideoStatus(
    userId: UserId,
    videoId: VideoId,
    status: { watchedAt?: Date | null; savedAt?: Date | null },
  ) {
    const rows = await this.sql`
      UPDATE video
      SET
        watched_at = CASE WHEN ${status.watchedAt !== undefined} THEN ${status.watchedAt ?? null} ELSE watched_at END,
        saved_at = CASE WHEN ${status.savedAt !== undefined} THEN ${status.savedAt ?? null} ELSE saved_at END
      WHERE video.video_id = ${String(videoId)}
        AND (
          video.user_id = ${userId} OR
          EXISTS (
            SELECT 1
            FROM donation
            WHERE donation.donation_id = video.donation_id
              AND donation.user_id = ${userId}
          )
        )
      RETURNING video.video_id
    `;
    return rows.length > 0;
  }

  async updateVideo(
    userId: UserId,
    videoId: VideoId,
    queueAmount: string,
    startSeconds: number,
    endSeconds: number,
  ) {
    const rows = await this.sql`
      UPDATE video
      SET
        queue_amount = ${queueAmount},
        start_seconds = ${startSeconds},
        end_seconds = ${endSeconds}
      WHERE video.video_id = ${String(videoId)}
        AND (
          video.user_id = ${userId} OR
          EXISTS (
            SELECT 1
            FROM donation
            WHERE donation.donation_id = video.donation_id
              AND donation.user_id = ${userId}
          )
        )
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
          FROM "user" other
          WHERE other.slug = ${slug}
            AND other.user_id <> ${userId}
        )
      RETURNING slug
    `;
    return rows.length > 0;
  }

  async setQueueCurrency(userId: UserId, queueCurrency: QueueCurrency, rate: MoneyAmount) {
    return await this.sql.begin(async (sql) => {
      const userRows = await sql`
        SELECT queue_currency
        FROM "user"
        WHERE user_id = ${userId}
        FOR UPDATE
      `;
      const previousCurrency = QueueCurrencySchema.parse(userRows[0]?.queueCurrency);
      if (previousCurrency === queueCurrency) return previousCurrency;

      const { numerator, denominator } = conversionFactorForCurrencyChange(
        previousCurrency,
        queueCurrency,
        rate,
      );
      const numeratorText = numerator.toString();
      const denominatorText = denominator.toString();

      await sql`
        UPDATE video_priority
        SET
          min_price_per_minute = round(min_price_per_minute * ${numeratorText} / ${denominatorText}, 2)
        WHERE user_id = ${userId}
      `;
      await sql`
        UPDATE video
        SET
          queue_amount = round(queue_amount * ${numeratorText} / ${denominatorText}, 2)
        WHERE video.queue_amount IS NOT NULL
          AND (
            video.user_id = ${userId} OR
            EXISTS (
              SELECT 1
              FROM donation
              WHERE donation.donation_id = video.donation_id
                AND donation.user_id = ${userId}
            )
          )
      `;
      await sql`
        UPDATE "user"
        SET queue_currency = ${queueCurrency}
        WHERE user_id = ${userId}
      `;
      return queueCurrency;
    });
  }

  async listSharedVideosPage(slug: string, input: { page: number; pageSize: number }) {
    const summaryRows = await this.sql`
      SELECT
        "user".user_id,
        (
          SELECT count(*)::int
          FROM video
          LEFT JOIN donation USING (donation_id)
          WHERE coalesce(video.user_id, donation.user_id) = "user".user_id
        ) AS total
      FROM "user"
      WHERE slug = ${slug}
    `;
    const summary = z
      .object({ userId: UserIdSchema, total: z.number().int().nonnegative() })
      .nullable()
      .parse(summaryRows[0] ?? null);
    if (summary === null) return null;
    const totalPages = Math.ceil(summary.total / input.pageSize);
    const page = Math.min(input.page, Math.max(totalPages, 1));
    const offset = (page - 1) * input.pageSize;
    const rows = await this.sql`
      SELECT
        video.video_id,
        video.video_priority_id,
        video.provider,
        video.provider_video_id,
        video.url,
        video.start_seconds,
        video.end_seconds,
        video.watched_at,
        video.saved_at,
        video_priority.label AS priority_label,
        video.queue_amount,
        "user".queue_currency,
        CASE
          WHEN donation.donation_id IS NULL THEN 'manual'
          ELSE 'donation'
        END AS source,
        coalesce(donation.occurred_at, video.added_at) AS created_at,
        CASE
          WHEN donation.donation_id IS NULL THEN NULL
          ELSE jsonb_build_object(
            'donationId',            donation.donation_id::text,
            'source',                donation.source,
            'sourceDonationId',      donation.source_donation_id,
            'userId',                donation.user_id,
            'author',                donation.author,
            'message',               donation.message,
            'amount',                donation.amount,
            'currency',              donation.currency,
            'sourceCreatedAt',       donation.source_created_at,
            'occurredAt',            donation.occurred_at
          )
        END AS donation
      FROM video
      LEFT JOIN donation USING (donation_id)
      LEFT JOIN video_priority USING (video_priority_id)
      JOIN "user"
        ON "user".user_id = coalesce(video.user_id, donation.user_id)
      WHERE "user".slug = ${slug}
      ORDER BY coalesce(donation.occurred_at, video.added_at) DESC, video.video_id DESC
      LIMIT ${input.pageSize}
      OFFSET ${offset}
    `;
    return {
      items: z.array(VideoSchema).parse(rows),
      page,
      pageSize: input.pageSize,
      total: summary.total,
      totalPages,
    };
  }

  private async getUserId(authUserId: AuthUserId) {
    const rows = await this.sql`
      SELECT user_id
      FROM "user"
      WHERE auth_user_id = ${authUserId}
    `;
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
          INSERT INTO "user" (auth_user_id, slug)
          VALUES (${authUserId}, ${preferredSlug})
          ON CONFLICT (auth_user_id) DO UPDATE
          SET auth_user_id = EXCLUDED.auth_user_id
          RETURNING user_id
        `;
        const userId = z
          .object({
            userId: UserIdSchema,
          })
          .parse(rows[0]).userId;
        await sql`
          INSERT INTO video_priority (
            user_id, label, min_price_per_minute, is_default
          )
          VALUES
            (${userId}, 'queue 0', 0, true),
            (${userId}, 'queue 1', 50, false),
            (${userId}, 'queue 2', 100, false),
            (${userId}, 'queue 3', 200, false)
          ON CONFLICT DO NOTHING
        `;
        return userId;
      })
      .catch(async () => await this.getOrCreateUserId(authUserId, `@${randomUUID()}`));
  }

  async getUsersAuthenticatedInDonationAlerts() {
    const rows = await this.sql`
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

  async getUserInfo(userId: UserId) {
    const rows = await this.sql`
      SELECT
        "user".user_id,
        "user".slug,
        "user".queue_currency,
        donationalerts_connection.user_id IS NOT NULL AS has_donation_alerts_connection
      FROM "user"
      LEFT JOIN donationalerts_connection USING (user_id)
      WHERE "user".user_id = ${userId}
    `;
    return UserInfoSchema.nullable().parse(rows[0] ?? null);
  }

  async saveDonationAlertsConnection(
    userId: UserId,
    connection: { sourceUserId: string; accessToken: AccessToken; refreshToken: RefreshToken },
  ) {
    await this.sql`
      INSERT INTO donationalerts_connection (
        user_id, source_user_id, access_token, refresh_token
      )
      VALUES (${userId}, ${connection.sourceUserId}, ${connection.accessToken}, ${connection.refreshToken})
      ON CONFLICT (user_id) DO UPDATE
      SET
        source_user_id = EXCLUDED.source_user_id,
        access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        token_version = donationalerts_connection.token_version + 1,
        updated_at = now()
    `;
  }

  async setTokens(userId: UserId, refreshToken: RefreshToken, accessToken: AccessToken) {
    await this.sql`
      UPDATE donationalerts_connection
      SET
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
