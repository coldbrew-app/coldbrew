import { conversionFactorForCurrencyChange } from "@coldbrew/packages/currency.js";
import {
  QueueCurrencySchema,
  SharedVideoSchema,
  UserIdSchema,
  VideoIdSchema,
  VideoPrioritySchema,
  VideoSchema,
  type MoneyAmount,
  type QueueCurrency,
  type Slug,
  type UserId,
  type VideoId,
} from "@coldbrew/packages/schemas.js";
import { youtubeVideoId } from "@coldbrew/packages/youtube.js";
import type { Sql, TransactionSql } from "postgres";
import { z } from "zod";

import type { RequestedYoutubeTiming, YoutubeTiming } from "../youtube.js";
import { VideoQueueError } from "./errors.js";
import type { SharedVideoStatus, VideoStatus } from "./types.js";

type YoutubeTimingLookup = (
  url: string,
  requestedTiming?: RequestedYoutubeTiming,
) => Promise<YoutubeTiming>;

function ownershipPredicate(sql: Sql | TransactionSql, userId: UserId) {
  return sql`
    video.user_id = ${userId} OR
    EXISTS (
      SELECT 1
      FROM donation
      WHERE donation.donation_id = video.donation_id
        AND donation.user_id = ${userId}
    )
  `;
}

class PostgresVideoQueue {
  constructor(
    private readonly sql: Sql,
    private readonly lookupYoutubeTiming: YoutubeTimingLookup,
  ) {}

  async listPage(
    userId: UserId,
    input: {
      page: number;
      pageSize: number;
      videoPriorityId: number | null;
      videoStatus: VideoStatus;
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
    const priorityCountSchema = z.object({
      videoPriorityId: z.int().positive(),
      count: z.int().nonnegative(),
    });
    const priorityDurationSchema = z.object({
      videoPriorityId: z.int().positive(),
      remainingSeconds: z.coerce.number().int().nonnegative(),
    });

    return {
      items: z.array(VideoSchema).parse(rows),
      page,
      pageSize: input.pageSize,
      priorityCounts: Object.fromEntries(
        z
          .array(priorityCountSchema)
          .parse(priorityCountRows)
          .map(({ videoPriorityId, count }) => [videoPriorityId, count]),
      ),
      remainingSecondsByPriorityId: Object.fromEntries(
        z
          .array(priorityDurationSchema)
          .parse(priorityDurationRows)
          .map(({ videoPriorityId, remainingSeconds }) => [videoPriorityId, remainingSeconds]),
      ),
      statusCounts: statusCountsSchema.parse(statusCountRows[0]),
      total,
      totalPages,
    };
  }

  async addManualVideo(
    userId: UserId,
    input: {
      url: string;
      amount: MoneyAmount;
      startSeconds: number;
      endSeconds: number | null;
    },
  ) {
    const providerVideoId = youtubeVideoId(input.url);
    if (providerVideoId === null) {
      throw new VideoQueueError("invalid youtube url");
    }

    let timing: YoutubeTiming;
    try {
      timing = await this.lookupYoutubeTiming(input.url, {
        startSeconds: input.startSeconds,
        endSeconds: input.endSeconds,
      });
    } catch (cause) {
      throw new VideoQueueError("youtube timing unavailable", { cause });
    }

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
        ${providerVideoId},
        ${input.url},
        ${input.amount},
        ${timing.startSeconds},
        ${timing.endSeconds},
        ${timing.durationSeconds}
      )
      RETURNING video_id
    `;
    const schema = z.object({
      videoId: VideoIdSchema,
    });

    return { videoId: schema.parse(rows[0]).videoId };
  }

  async listPriorities(userId: UserId) {
    const rows = await this.sql`
      SELECT video_priority_id, label, is_default, min_price_per_minute
      FROM video_priority
      WHERE user_id = ${userId}
      ORDER BY min_price_per_minute DESC, video_priority_id ASC
    `;
    return z.array(VideoPrioritySchema).parse(rows);
  }

  async updatePriority(
    userId: UserId,
    input: {
      videoPriorityId: number;
      label: string;
      minPricePerMinute: MoneyAmount;
    },
  ) {
    const rows = await this.sql`
      UPDATE video_priority
      SET
        label = ${input.label},
        min_price_per_minute = CASE WHEN is_default THEN 0 ELSE ${input.minPricePerMinute} END
      WHERE user_id = ${userId}
        AND video_priority_id = ${input.videoPriorityId}
      RETURNING video_priority_id, label, is_default, min_price_per_minute
    `;
    const priority = VideoPrioritySchema.optional().parse(rows[0]);
    if (priority === undefined) {
      throw new VideoQueueError("video priority not found");
    }
    return priority;
  }

  async updateStatus(
    userId: UserId,
    videoId: VideoId,
    status: { watchedAt?: Date | null; bookmarkedAt?: Date | null },
  ) {
    const ownsVideo = ownershipPredicate(this.sql, userId);
    const rows = await this.sql`
      UPDATE video
      SET
        watched_at = CASE WHEN ${status.watchedAt !== undefined} THEN ${status.watchedAt ?? null} ELSE watched_at END,
        bookmarked_at = CASE WHEN ${status.bookmarkedAt !== undefined} THEN ${status.bookmarkedAt ?? null} ELSE bookmarked_at END
      WHERE video.video_id = ${String(videoId)}
        AND (${ownsVideo})
      RETURNING video.video_id
    `;
    if (rows.length === 0) {
      throw new VideoQueueError("video not found");
    }
  }

  async updateVideo(
    userId: UserId,
    videoId: VideoId,
    input: { amount: MoneyAmount; startSeconds: number; endSeconds: number },
  ) {
    const ownsVideo = ownershipPredicate(this.sql, userId);
    const rows = await this.sql`
      UPDATE video
      SET
        queue_amount = ${input.amount},
        start_seconds = ${input.startSeconds},
        end_seconds = ${input.endSeconds}
      WHERE video.video_id = ${String(videoId)}
        AND (${ownsVideo})
      RETURNING video.video_id
    `;
    if (rows.length === 0) {
      throw new VideoQueueError("video not found");
    }
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
      if (previousCurrency === queueCurrency) {
        return previousCurrency;
      }

      const { numerator, denominator } = conversionFactorForCurrencyChange(
        previousCurrency,
        queueCurrency,
        rate,
      );
      const numeratorText = numerator.toString();
      const denominatorText = denominator.toString();
      const ownsVideo = ownershipPredicate(sql, userId);

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
          AND (${ownsVideo})
      `;
      await sql`
        UPDATE "user"
        SET queue_currency = ${queueCurrency}
        WHERE user_id = ${userId}
      `;
      return queueCurrency;
    });
  }

  async listSharedPage(
    slug: Slug,
    input: { page: number; pageSize: number; status: SharedVideoStatus },
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
    if (!summary?.publicQueueEnabled) {
      return null;
    }

    const status: SharedVideoStatus =
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

    return {
      items: z.array(SharedVideoSchema).parse(rows),
      page,
      pageSize: input.pageSize,
      priorities: z.array(prioritySchema).parse(status === "queue" ? priorityRows : []),
      showWatchedVideos: summary.publicQueueShowWatched,
      status,
      total: summary.total,
      totalPages,
    };
  }
}

export function createPostgresVideoQueue(sql: Sql, lookupYoutubeTiming: YoutubeTimingLookup) {
  return new PostgresVideoQueue(sql, lookupYoutubeTiming);
}
