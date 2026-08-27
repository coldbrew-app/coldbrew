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
  PublicQueueSettings,
  PublicQueueSettingsSchema,
  QueueCurrencySchema,
  QueueCurrency,
  RefreshToken,
  SharedVideoSchema,
  Slug,
  SlugSchema,
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
    const schema = z.object({
      donationCount: z.int().nonnegative(),
      totalAmount: z.coerce.number(),
    });
    const summary = schema.parse(summaryRows[0]);
    return { ...summary, recentDonations: z.array(DonationSchema).parse(recentRows) };
  }

  async listVideosPage(
    userId: UserId,
    input: {
      page: number;
      pageSize: number;
      videoPriorityId: number | null;
      videoStatus: "all" | "notwatched" | "watched" | "bookmarked";
    },
  ) {
    const statisticRows = await Promise.all([
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
            OR (${input.videoStatus} = 'bookmarked' AND video.bookmarked_at IS NOT NULL)
          )
      `,
      this.sql`
        SELECT
          count(*)::int AS all,
          count(*) FILTER (WHERE video.watched_at IS NULL)::int AS notwatched,
          count(*) FILTER (WHERE video.watched_at IS NOT NULL)::int AS watched,
          count(*) FILTER (WHERE video.bookmarked_at IS NOT NULL)::int AS bookmarked
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
            OR (${input.videoStatus} = 'bookmarked' AND video.bookmarked_at IS NOT NULL)
          )
        GROUP BY video.video_priority_id
      `,
      this.sql`
        SELECT
          video_priority.video_priority_id,
          coalesce(
            sum(video.end_seconds - video.start_seconds)
              FILTER (WHERE video.watched_at IS NULL),
            0
          )::bigint AS remaining_seconds
        FROM video_priority
        LEFT JOIN video USING (video_priority_id)
        WHERE video_priority.user_id = ${userId}
        GROUP BY video_priority.video_priority_id
      `,
    ]);
    const [countRows, statusCountRows, priorityCountRows, priorityDurationRows] = statisticRows;
    const countSchema = z.object({
      total: z.int().nonnegative(),
    });
    const total = countSchema.parse(countRows[0]).total;
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
        video.bookmarked_at,
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
          OR (${input.videoStatus} = 'bookmarked' AND video.bookmarked_at IS NOT NULL)
        )
      ORDER BY
        CASE
          WHEN ${input.videoStatus} = 'watched' THEN video.watched_at
          WHEN ${input.videoStatus} = 'bookmarked' THEN video.bookmarked_at
          ELSE coalesce(donation.occurred_at, video.added_at)
        END DESC,
        video.video_id DESC
      LIMIT ${input.pageSize}
      OFFSET ${offset}
    `;
    const statusCountsSchema = z.object({
      all: z.int().nonnegative(),
      notwatched: z.int().nonnegative(),
      watched: z.int().nonnegative(),
      bookmarked: z.int().nonnegative(),
    });
    const statusCounts = statusCountsSchema.parse(statusCountRows[0]);
    const priorityCountSchema = z.object({
      videoPriorityId: z.int().positive(),
      count: z.int().nonnegative(),
    });
    const priorityCounts = Object.fromEntries(
      z
        .array(priorityCountSchema)
        .parse(priorityCountRows)
        .map(({ videoPriorityId, count }) => [videoPriorityId, count]),
    );
    const priorityDurationSchema = z.object({
      videoPriorityId: z.int().positive(),
      remainingSeconds: z.coerce.number().int().nonnegative(),
    });
    const remainingSecondsByPriorityId = Object.fromEntries(
      z
        .array(priorityDurationSchema)
        .parse(priorityDurationRows)
        .map(({ videoPriorityId, remainingSeconds }) => [videoPriorityId, remainingSeconds]),
    );
    return {
      items: z.array(VideoSchema).parse(rows),
      page,
      pageSize: input.pageSize,
      priorityCounts,
      remainingSecondsByPriorityId,
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
      durationSeconds: number;
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
        end_seconds,
        duration_seconds
      )
      VALUES (
        ${userId},
        now(),
        'youtube',
        ${input.providerVideoId},
        ${input.url},
        ${input.queueAmount},
        ${input.startSeconds},
        ${input.endSeconds},
        ${input.durationSeconds}
      )
      RETURNING video_id
    `;
    const schema = z.object({
      videoId: VideoIdSchema,
    });

    return schema.parse(rows[0]).videoId;
  }

  async listVideoPriorities(userId: UserId) {
    const rows = await this.sql`
      SELECT video_priority_id, label, is_default, min_price_per_minute
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
    minPricePerMinute: string,
  ) {
    const rows = await this.sql`
      UPDATE video_priority
      SET
        label = ${label},
        min_price_per_minute = CASE WHEN is_default THEN 0 ELSE ${minPricePerMinute} END
      WHERE user_id = ${userId}
        AND video_priority_id = ${videoPriorityId}
      RETURNING video_priority_id, label, is_default, min_price_per_minute
    `;
    return VideoPrioritySchema.optional().parse(rows[0]) ?? null;
  }

  async updateVideoStatus(
    userId: UserId,
    videoId: VideoId,
    status: { watchedAt?: Date | null; bookmarkedAt?: Date | null },
  ) {
    const rows = await this.sql`
      UPDATE video
      SET
        watched_at = CASE WHEN ${status.watchedAt !== undefined} THEN ${status.watchedAt ?? null} ELSE watched_at END,
        bookmarked_at = CASE WHEN ${status.bookmarkedAt !== undefined} THEN ${status.bookmarkedAt ?? null} ELSE bookmarked_at END
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

  async setQueueCurrency(userId: UserId, queueCurrency: QueueCurrency, rate: MoneyAmount) {
    return await this.sql.begin(async (sql) => {
      const userRows = await sql`
        SELECT queue_currency
        FROM "user"
        WHERE user_id = ${userId}
        FOR UPDATE
      `;
      const schema = z.object({
        queueCurrency: QueueCurrencySchema,
      });
      const previousCurrency = schema.parse(userRows[0]).queueCurrency;
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

  async listSharedVideosPage(
    slug: Slug,
    input: { page: number; pageSize: number; status: "queue" | "watched" },
  ) {
    const summaryRows = await this.sql`
      SELECT
        "user".user_id,
        "user".public_queue_enabled,
        "user".public_queue_show_amounts,
        "user".public_queue_show_watched,
        (
          SELECT count(*)::int
          FROM video
          LEFT JOIN donation USING (donation_id)
          WHERE coalesce(video.user_id, donation.user_id) = "user".user_id
            AND CASE
              WHEN ${input.status} = 'watched' AND "user".public_queue_show_watched
                THEN video.watched_at IS NOT NULL
              ELSE video.watched_at IS NULL
            END
        ) AS total
      FROM "user"
      WHERE slug = ${slug}
    `;
    const summarySchema = z.object({
      userId: UserIdSchema,
      publicQueueEnabled: z.boolean(),
      publicQueueShowAmounts: z.boolean(),
      publicQueueShowWatched: z.boolean(),
      total: z.int().nonnegative(),
    });
    const summary = summarySchema.optional().parse(summaryRows[0]);
    if (summary === undefined || !summary.publicQueueEnabled) return null;
    const status: "queue" | "watched" =
      input.status === "watched" && summary.publicQueueShowWatched ? "watched" : "queue";
    const totalPages = Math.ceil(summary.total / input.pageSize);
    const page = Math.min(input.page, Math.max(totalPages, 1));
    const offset = (page - 1) * input.pageSize;
    const [rows, priorityRows] = await Promise.all([
      this.sql`
        SELECT
          video.video_id,
          video.video_priority_id,
          video.provider,
          video.url,
          video.start_seconds,
          video.end_seconds,
          video.duration_seconds,
          video.watched_at,
          video_priority.label AS priority_label,
          CASE
            WHEN "user".public_queue_show_amounts
              THEN coalesce(video.queue_amount, donation.amount, 0::money_amount)
            ELSE NULL
          END AS display_amount,
          CASE
            WHEN NOT "user".public_queue_show_amounts THEN NULL
            WHEN video.queue_amount IS NULL AND donation.donation_id IS NOT NULL
              THEN donation.currency
            ELSE "user".queue_currency
          END AS display_currency,
          coalesce(donation.occurred_at, video.added_at) AS created_at
        FROM video
        LEFT JOIN donation USING (donation_id)
        LEFT JOIN video_priority USING (video_priority_id)
        JOIN "user"
          ON "user".user_id = coalesce(video.user_id, donation.user_id)
        WHERE "user".slug = ${slug}
          AND CASE
            WHEN ${status} = 'watched' THEN video.watched_at IS NOT NULL
            ELSE video.watched_at IS NULL
          END
        ORDER BY
          CASE WHEN ${status} = 'queue' THEN video_priority.min_price_per_minute END DESC NULLS LAST,
          CASE
            WHEN ${status} = 'watched' THEN video.watched_at
            ELSE coalesce(donation.occurred_at, video.added_at)
          END DESC,
          video.video_id DESC
        LIMIT ${input.pageSize}
        OFFSET ${offset}
      `,
      this.sql`
        SELECT
          video_priority.video_priority_id,
          video_priority.label,
          count(video.video_id) FILTER (WHERE video.watched_at IS NULL)::int AS video_count,
          coalesce(
            sum(video.end_seconds - video.start_seconds)
              FILTER (WHERE video.watched_at IS NULL),
            0
          )::bigint AS remaining_seconds
        FROM video_priority
        LEFT JOIN video USING (video_priority_id)
        WHERE video_priority.user_id = ${summary.userId}
        GROUP BY
          video_priority.video_priority_id,
          video_priority.label,
          video_priority.min_price_per_minute
        ORDER BY
          video_priority.min_price_per_minute DESC,
          video_priority.video_priority_id ASC
      `,
    ]);
    const prioritySchema = z.object({
      videoPriorityId: z.int().positive(),
      label: z.string().trim().min(1).max(64),
      videoCount: z.int().nonnegative(),
      remainingSeconds: z.coerce.number().int().nonnegative(),
    });
    const priorities = z.array(prioritySchema).parse(status === "queue" ? priorityRows : []);
    return {
      items: z.array(SharedVideoSchema).parse(rows),
      page,
      pageSize: input.pageSize,
      priorities,
      showWatchedVideos: summary.publicQueueShowWatched,
      status,
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
    const schema = z.object({
      userId: UserIdSchema,
    });

    return schema.optional().parse(rows[0])?.userId ?? null;
  }

  async getOrCreateUserId(authUserId: AuthUserId, preferredSlug: Slug): Promise<UserId> {
    const existing = await this.getUserId(authUserId);
    if (existing) return existing;
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
        });
      } catch (error) {
        if (!isUserSlugConflict(error)) throw error;
        slug = SlugSchema.parse(randomUUID());
      }
    }
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
