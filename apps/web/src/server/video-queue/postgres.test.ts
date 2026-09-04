import {
  MoneyAmountSchema,
  QueueCurrencySchema,
  SlugSchema,
  UserIdSchema,
  VideoIdSchema,
} from "@coldbrew/packages/schemas.js";
import type { Sql } from "postgres";
import { describe, expect, it, vi } from "vitest";

import { VideoQueueError } from "./errors.js";
import { createPostgresVideoQueue } from "./postgres.js";

type Query = { text: string; values: unknown[] };

function createSqlMock(handle: (query: Query) => unknown[]) {
  const queries: Query[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = {
      text: strings.join(" ? ").replace(/\s+/g, " ").trim(),
      values,
    };
    queries.push(query);
    return Promise.resolve(handle(query));
  };
  const begin = vi.fn(async (run: (transaction: typeof tag) => Promise<unknown>) => await run(tag));
  return { sql: Object.assign(tag, { begin }) as never as Sql, queries, begin };
}

const userId = UserIdSchema.parse(7);
const videoId = VideoIdSchema.parse("41");
const amount = MoneyAmountSchema.parse("120");

function manualVideoRow() {
  return {
    videoId: "41",
    videoPriorityId: 3,
    provider: "youtube",
    providerVideoId: "youtube-id",
    url: "https://youtu.be/youtube-id",
    queueAmount: "120.00",
    queueCurrency: "RUB",
    startSeconds: 10,
    endSeconds: 70,
    priorityLabel: "queue 2",
    watchedAt: null,
    bookmarkedAt: null,
    source: "manual",
    createdAt: new Date("2026-01-02T00:00:00Z"),
    donation: null,
  };
}

describe("PostgresVideoQueue", () => {
  it("looks up timing before inserting a manual video", async () => {
    const order: string[] = [];
    const database = createSqlMock((query) => {
      expect(query.text).toContain("INSERT INTO video");
      order.push("insert");
      return [{ videoId: "41" }];
    });
    const lookupTiming = vi.fn(async () => {
      order.push("timing");
      return { startSeconds: 10, endSeconds: 70, durationSeconds: 90 };
    });
    const queue = createPostgresVideoQueue(database.sql, lookupTiming);

    await expect(
      queue.addManualVideo(userId, {
        url: "https://youtu.be/youtube-id",
        amount,
        startSeconds: 10,
        endSeconds: 70,
      }),
    ).resolves.toEqual({ videoId });
    expect(order).toEqual(["timing", "insert"]);
    expect(database.queries[0]?.values).toContain("youtube-id");
  });

  it("rejects an invalid URL without timing lookup or insert", async () => {
    const database = createSqlMock(() => []);
    const lookupTiming = vi.fn();
    const queue = createPostgresVideoQueue(database.sql, lookupTiming);

    await expect(
      queue.addManualVideo(userId, {
        url: "https://example.com/video",
        amount,
        startSeconds: 0,
        endSeconds: null,
      }),
    ).rejects.toMatchObject({ type: "invalid youtube url" });
    expect(lookupTiming).not.toHaveBeenCalled();
    expect(database.queries).toEqual([]);
  });

  it("preserves the timing failure as the module error cause", async () => {
    const cause = new Error("youtube unavailable");
    const queue = createPostgresVideoQueue(
      createSqlMock(() => []).sql,
      vi.fn(async () => await Promise.reject(cause)),
    );

    await expect(
      queue.addManualVideo(userId, {
        url: "https://youtu.be/youtube-id",
        amount,
        startSeconds: 0,
        endSeconds: null,
      }),
    ).rejects.toEqual(new VideoQueueError("youtube timing unavailable", { cause }));
  });

  it("localizes ownership to direct and donation-owned videos", async () => {
    const database = createSqlMock((query) =>
      query.text.startsWith("UPDATE video SET") ? [{ videoId: "41" }] : [],
    );
    const queue = createPostgresVideoQueue(database.sql, vi.fn());

    await queue.updateVideo(userId, videoId, {
      amount,
      startSeconds: 5,
      endSeconds: 65,
    });

    const ownership = database.queries.find((query) => query.text.startsWith("video.user_id"));
    expect(ownership?.text).toContain("donation.donation_id = video.donation_id");
    expect(ownership?.values).toEqual([userId, userId]);
  });

  it("updates watched and bookmarked state independently", async () => {
    const database = createSqlMock((query) =>
      query.text.startsWith("UPDATE video SET") ? [{ videoId: "41" }] : [],
    );
    const queue = createPostgresVideoQueue(database.sql, vi.fn());
    const watchedAt = new Date("2026-02-03T04:05:06Z");

    await queue.updateStatus(userId, videoId, { watchedAt });

    const update = database.queries.find((query) => query.text.startsWith("UPDATE video SET"));
    expect(update?.text).toContain("ELSE watched_at END");
    expect(update?.text).toContain("ELSE bookmarked_at END");
    expect(update?.values.slice(0, 4)).toEqual([true, watchedAt, false, null]);
  });

  it("keeps the default priority threshold at zero", async () => {
    const database = createSqlMock(() => [
      {
        videoPriorityId: 1,
        label: "default",
        isDefault: true,
        minPricePerMinute: "0.00",
      },
    ]);
    const queue = createPostgresVideoQueue(database.sql, vi.fn());

    await expect(
      queue.updatePriority(userId, {
        videoPriorityId: 1,
        label: "default",
        minPricePerMinute: MoneyAmountSchema.parse("999"),
      }),
    ).resolves.toMatchObject({ isDefault: true, minPricePerMinute: "0.00" });
    expect(database.queries[0]?.text).toContain("CASE WHEN is_default THEN 0");
  });

  it("changes currency and all queue amounts in one transaction", async () => {
    const database = createSqlMock((query) =>
      query.text.startsWith("SELECT queue_currency") ? [{ queueCurrency: "RUB" }] : [],
    );
    const queue = createPostgresVideoQueue(database.sql, vi.fn());

    await expect(
      queue.setQueueCurrency(
        userId,
        QueueCurrencySchema.parse("USD"),
        MoneyAmountSchema.parse("0.01"),
      ),
    ).resolves.toBe("USD");

    expect(database.begin).toHaveBeenCalledOnce();
    expect(database.queries.map(({ text }) => text)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("FOR UPDATE"),
        expect.stringContaining("UPDATE video_priority"),
        expect.stringContaining("UPDATE video SET queue_amount"),
        expect.stringContaining('UPDATE "user" SET queue_currency'),
      ]),
    );
  });

  it("clamps private pagination and returns all counts", async () => {
    const database = createSqlMock((query) => {
      if (query.text.startsWith("SELECT count(*)::int AS total")) return [{ total: 51 }];
      if (query.text.includes("AS all")) {
        return [{ all: 60, notwatched: 40, watched: 20, bookmarked: 5 }];
      }
      if (query.text.startsWith("SELECT video.video_priority_id, count")) {
        return [{ videoPriorityId: 3, count: 12 }];
      }
      if (query.text.includes("AS remaining_seconds")) {
        return [{ videoPriorityId: 3, remainingSeconds: "600" }];
      }
      if (query.text.includes("AS source")) return [manualVideoRow()];
      return [];
    });
    const queue = createPostgresVideoQueue(database.sql, vi.fn());

    await expect(
      queue.listPage(userId, {
        page: 9,
        pageSize: 25,
        videoPriorityId: null,
        videoStatus: "all",
      }),
    ).resolves.toMatchObject({
      page: 3,
      total: 51,
      totalPages: 3,
      priorityCounts: { 3: 12 },
      remainingSecondsByPriorityId: { 3: 600 },
      statusCounts: { all: 60, notwatched: 40, watched: 20, bookmarked: 5 },
    });
    const pageQuery = database.queries.find((query) => query.text.includes("AS source"));
    expect(pageQuery?.values.at(-1)).toBe(50);
  });

  it("hides disabled public queues without loading their videos", async () => {
    const database = createSqlMock(() => [
      {
        userId: 7,
        publicQueueEnabled: false,
        publicQueueShowAmounts: true,
        publicQueueShowWatched: true,
        total: 1,
      },
    ]);
    const queue = createPostgresVideoQueue(database.sql, vi.fn());

    await expect(
      queue.listSharedPage(SlugSchema.parse("streamer"), {
        page: 1,
        pageSize: 25,
        status: "queue",
      }),
    ).resolves.toBeNull();
    expect(database.queries).toHaveLength(1);
  });

  it("falls back to the visible queue and preserves public counts", async () => {
    const database = createSqlMock((query) => {
      if (query.text.includes("public_queue_enabled")) {
        return [
          {
            userId: 7,
            publicQueueEnabled: true,
            publicQueueShowAmounts: true,
            publicQueueShowWatched: false,
            total: 26,
          },
        ];
      }
      if (query.text.includes("video.duration_seconds")) {
        return [
          {
            videoId: "41",
            videoPriorityId: 3,
            provider: "youtube",
            url: "https://youtu.be/youtube-id",
            startSeconds: 10,
            endSeconds: 70,
            durationSeconds: 90,
            watchedAt: null,
            priorityLabel: "queue 2",
            displayAmount: "120.00",
            displayCurrency: "RUB",
            createdAt: new Date("2026-01-02T00:00:00Z"),
          },
        ];
      }
      return [
        {
          videoPriorityId: 3,
          label: "queue 2",
          videoCount: 4,
          remainingSeconds: "600",
        },
      ];
    });
    const queue = createPostgresVideoQueue(database.sql, vi.fn());

    await expect(
      queue.listSharedPage(SlugSchema.parse("streamer"), {
        page: 8,
        pageSize: 25,
        status: "watched",
      }),
    ).resolves.toMatchObject({
      page: 2,
      status: "queue",
      total: 26,
      totalPages: 2,
      showWatchedVideos: false,
      priorities: [{ videoPriorityId: 3, videoCount: 4, remainingSeconds: 600 }],
    });
  });
});
