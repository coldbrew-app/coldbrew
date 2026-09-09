import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { AuthUserIdSchema, MoneyAmountSchema, SlugSchema } from "@coldbrew/packages/schemas.js";
import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Store } from "../sensors/db/store.js";
import { createPostgresVideoQueue } from "./postgres.js";

const databaseUrl = process.env["VIDEO_INGEST_TEST_DATABASE_URL"];

describe.skipIf(!databaseUrl)("video queues in PostgreSQL", () => {
  let sql: ReturnType<typeof postgres>;
  let admin: ReturnType<typeof postgres>;
  let schemaName: string;
  let queue: ReturnType<typeof createPostgresVideoQueue>;

  beforeEach(async () => {
    schemaName = `video_queue_test_${randomUUID().replaceAll("-", "")}`;
    admin = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE SCHEMA ${schemaName}`);
    sql = postgres(databaseUrl!, {
      transform: postgres.camel,
      connection: { search_path: schemaName },
      onnotice: () => {},
    });
    queue = createPostgresVideoQueue(sql);
    const schema = await readFile(new URL("../../../../../db/schema.sql", import.meta.url), "utf8");
    await sql.unsafe(schema);
  });

  afterEach(async () => {
    await sql?.end();
    // This generated schema belongs only to this test, never to the application's data.
    if (schemaName) await admin.unsafe(`DROP SCHEMA ${schemaName} CASCADE`);
    await admin?.end();
  });

  async function user(name = "streamer") {
    await sql`INSERT INTO auth_user (id, name, email, "emailVerified") VALUES (${name}, ${name}, ${`${name}@test.invalid`}, true)`;
    const id = await new Store(sql).getOrCreateUserId(
      AuthUserIdSchema.parse(name),
      SlugSchema.parse(name),
    );
    const queues = await queue.listQueues(id);
    return { id, main: queues[0]!, slug: SlugSchema.parse(name) };
  }

  const videoInput = {
    url: "https://youtu.be/abcdefghijk",
    amount: MoneyAmountSchema.parse("120"),
    startSeconds: 0,
    endSeconds: 60,
  };
  const pageInput = { page: 1, pageSize: 25, videoPriorityId: null, videoStatus: "all" as const };

  it("creates one default queue per user and copies independently editable priorities", async () => {
    const owner = await user();
    const second = await queue.createQueue(owner.id, "Kick");
    const initial = await queue.listPriorities(owner.id, owner.main.videoQueueId);
    const copied = await queue.listPriorities(owner.id, second.videoQueueId);
    expect(
      copied.map(({ label, minPricePerMinute, isDefault }) => ({
        label,
        minPricePerMinute,
        isDefault,
      })),
    ).toEqual(
      initial.map(({ label, minPricePerMinute, isDefault }) => ({
        label,
        minPricePerMinute,
        isDefault,
      })),
    );
    expect(copied.map((p) => p.videoPriorityId)).not.toEqual(initial.map((p) => p.videoPriorityId));
    await queue.updatePriority(owner.id, {
      videoPriorityId: copied[0]!.videoPriorityId,
      label: "Urgent",
      minPricePerMinute: MoneyAmountSchema.parse("500"),
    });
    expect(await queue.listPriorities(owner.id, owner.main.videoQueueId)).toEqual(initial);
    expect((await queue.listQueues(owner.id)).filter((q) => q.isDefault)).toHaveLength(1);
    await expect(queue.createQueue(owner.id, "Kick")).rejects.toMatchObject({
      type: "video queue name taken",
    });
  });

  it("moves a video, recalculates priority and scopes counts and public pages", async () => {
    const owner = await user();
    const second = await queue.createQueue(owner.id, "Kick");
    const priorities = await queue.listPriorities(owner.id, second.videoQueueId);
    for (const priority of priorities.filter((p) => !p.isDefault)) {
      await queue.updatePriority(owner.id, {
        ...priority,
        minPricePerMinute: MoneyAmountSchema.parse("500"),
      });
    }
    const { videoId } = await queue.addManualVideo(owner.id, videoInput);
    const original = (await queue.listPage(owner.id, pageInput)).items[0]!;
    await queue.moveVideo(owner.id, videoId, second.videoQueueId);
    const empty = await queue.listPage(owner.id, pageInput);
    expect(empty.total).toBe(0);
    expect(empty.statusCounts.all).toBe(0);
    expect(Object.values(empty.priorityCounts)).toEqual([]);
    expect(
      Object.values(empty.remainingSecondsByPriorityId).every((seconds) => seconds === 0),
    ).toBe(true);
    const moved = await queue.listPage(owner.id, {
      ...pageInput,
      videoQueueId: second.videoQueueId,
    });
    expect(moved.items[0]).toMatchObject({
      videoId,
      videoQueueId: second.videoQueueId,
      queueAmount: original.queueAmount,
    });
    expect(moved.items[0]!.videoPriorityId).toBe(
      priorities.find((p) => p.isDefault)!.videoPriorityId,
    );
    const focused = await queue.listPage(owner.id, { ...pageInput, videoId });
    expect(focused.queue.videoQueueId).toBe(second.videoQueueId);
    const publicMain = await queue.listSharedPage(owner.slug, {
      page: 1,
      pageSize: 25,
      status: "queue",
    });
    const publicKick = await queue.listSharedPage(owner.slug, {
      page: 1,
      pageSize: 25,
      status: "queue",
      videoQueueId: second.videoQueueId,
    });
    expect(publicMain?.total).toBe(0);
    expect(publicKick?.total).toBe(1);
    expect(publicKick?.queues).toHaveLength(2);
    expect(publicKick?.priorities.reduce((sum, p) => sum + p.remainingSeconds, 0)).toBe(60);
    expect(publicKick?.items[0]).not.toHaveProperty("donation");
  });

  it("keeps an unknown-duration video in its chosen queue through metadata completion", async () => {
    const owner = await user();
    const second = await queue.createQueue(owner.id, "Kick");
    const { videoId } = await queue.addManualVideo(owner.id, {
      ...videoInput,
      videoQueueId: second.videoQueueId,
      endSeconds: null,
    });
    await queue.moveVideo(owner.id, videoId, owner.main.videoQueueId);
    const pending = (await queue.listPage(owner.id, pageInput)).items[0]!;
    expect(pending).toMatchObject({
      videoQueueId: owner.main.videoQueueId,
      videoPriorityId: null,
      queueAmount: "120.00",
    });
    await sql`UPDATE video SET end_seconds = 60, duration_seconds = 60 WHERE video_id = ${String(videoId)}`;
    const ready = (await queue.listPage(owner.id, pageInput)).items[0]!;
    expect(ready.videoQueueId).toBe(owner.main.videoQueueId);
    expect((await queue.listPriorities(owner.id)).map((p) => p.videoPriorityId)).toContain(
      ready.videoPriorityId,
    );
  });

  it("preserves watched and bookmarked state, timing and money when moving", async () => {
    const owner = await user();
    const second = await queue.createQueue(owner.id, "Kick");
    const { videoId } = await queue.addManualVideo(owner.id, videoInput);
    const date = new Date("2026-09-09T12:00:00Z");
    await queue.updateStatus(owner.id, videoId, { watchedAt: date, bookmarkedAt: date });
    await queue.moveVideo(owner.id, videoId, second.videoQueueId);
    const page = await queue.listPage(owner.id, {
      ...pageInput,
      videoQueueId: second.videoQueueId,
    });
    expect(page.items[0]).toMatchObject({
      watchedAt: date,
      bookmarkedAt: date,
      startSeconds: 0,
      endSeconds: 60,
      queueAmount: "120.00",
    });
    expect(page.statusCounts).toEqual({ all: 1, notwatched: 0, watched: 1, bookmarked: 1 });
  });

  it("uses the selected default for newly scanned donation videos without moving existing videos", async () => {
    const owner = await user();
    const original = await queue.addManualVideo(owner.id, videoInput);
    const second = await queue.createQueue(owner.id, "Kick");
    await queue.updateQueue(owner.id, { ...second, isDefault: true });
    await sql`INSERT INTO donation (user_id, amount, currency, source, source_donation_id, source_created_at, occurred_at)
      VALUES (${owner.id}, 120, 'RUB', 'donationalerts', 'one', 'test', now())`;
    await sql`INSERT INTO video (donation_id, provider, provider_video_id, url, queue_amount, start_seconds, end_seconds)
      SELECT donation_id, 'youtube', 'abcdefghijk', ${videoInput.url}, 120, 0, 60 FROM donation`;
    const page = await queue.listPage(owner.id, pageInput);
    expect(page.queue.videoQueueId).toBe(second.videoQueueId);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.source).toBe("donation");
    expect(
      (await queue.listPage(owner.id, { ...pageInput, videoQueueId: owner.main.videoQueueId }))
        .items[0]!.videoId,
    ).toBe(original.videoId);
    await Promise.all([
      queue.updateQueue(owner.id, { ...owner.main, isDefault: true }),
      queue.updateQueue(owner.id, { ...second, isDefault: true }),
    ]);
    expect((await queue.listQueues(owner.id)).filter((q) => q.isDefault)).toHaveLength(1);
  });

  it("rejects cross-user reads, additions, moves and priority associations", async () => {
    const owner = await user();
    const other = await user("other");
    const { videoId } = await queue.addManualVideo(owner.id, videoInput);
    await expect(queue.moveVideo(other.id, videoId, other.main.videoQueueId)).rejects.toThrow();
    await expect(queue.moveVideo(owner.id, videoId, other.main.videoQueueId)).rejects.toThrow();
    await expect(
      queue.addManualVideo(owner.id, { ...videoInput, videoQueueId: other.main.videoQueueId }),
    ).rejects.toThrow();
    await expect(
      queue.listPage(owner.id, { ...pageInput, videoQueueId: other.main.videoQueueId }),
    ).rejects.toThrow();
    await expect(queue.updateQueue(owner.id, { ...other.main, label: "stolen" })).rejects.toThrow();
    expect(await queue.listPriorities(owner.id, other.main.videoQueueId)).toEqual([]);
    expect(
      await queue.listSharedPage(owner.slug, {
        page: 1,
        pageSize: 25,
        status: "queue",
        videoQueueId: other.main.videoQueueId,
      }),
    ).toBeNull();
    await expect(
      sql`UPDATE video SET video_queue_id = ${other.main.videoQueueId} WHERE video_id = ${String(videoId)}`,
    ).rejects.toThrow();
    const foreignPriority = (await queue.listPriorities(other.id))[0]!;
    await expect(
      sql`UPDATE video SET video_priority_id = ${foreignPriority.videoPriorityId} WHERE video_id = ${String(videoId)}`,
    ).rejects.toThrow();
    expect((await queue.listPage(owner.id, pageInput)).items[0]!.videoQueueId).toBe(
      owner.main.videoQueueId,
    );
  });

  it("converts money and thresholds across queues in the user's currency", async () => {
    const owner = await user();
    const second = await queue.createQueue(owner.id, "Kick");
    await queue.addManualVideo(owner.id, videoInput);
    await queue.addManualVideo(owner.id, { ...videoInput, videoQueueId: second.videoQueueId });
    await queue.setQueueCurrency(owner.id, "USD", MoneyAmountSchema.parse("100"));
    for (const videoQueueId of [owner.main.videoQueueId, second.videoQueueId]) {
      const page = await queue.listPage(owner.id, { ...pageInput, videoQueueId });
      expect(page.items[0]).toMatchObject({
        queueCurrency: "USD",
        queueAmount: "1.20",
        videoQueueId,
      });
      expect(
        (await queue.listPriorities(owner.id, videoQueueId)).map((p) => p.minPricePerMinute),
      ).toEqual(["2.00", "1.00", "0.50", "0.00"]);
    }
  });

  it("backfills legacy videos and priorities without changing their history, and can be rerun", async () => {
    const owner = await user();
    await queue.addManualVideo(owner.id, videoInput);
    await queue.addManualVideo(owner.id, { ...videoInput, endSeconds: null });
    await sql`INSERT INTO donation (user_id, amount, currency, source, source_donation_id, source_created_at, occurred_at)
      VALUES (${owner.id}, 120, 'RUB', 'donationalerts', 'one', 'test', now())`;
    await sql`INSERT INTO video (donation_id, provider, provider_video_id, url, queue_amount, start_seconds, end_seconds)
      SELECT donation_id, 'youtube', 'abcdefghijk', ${videoInput.url}, 120, 0, 60 FROM donation`;
    await sql`UPDATE video SET watched_at = '2026-09-09', bookmarked_at = '2026-09-09' WHERE end_seconds IS NOT NULL`;
    // Reconstruct the pre-feature tables inside this test's isolated schema.
    await sql.unsafe(`DROP TRIGGER set_video_priority_id ON video;
      ALTER TABLE video DROP COLUMN video_queue_id CASCADE;
      ALTER TABLE video_priority DROP COLUMN video_queue_id CASCADE;
      DROP TABLE video_queue;
      CREATE UNIQUE INDEX video_priority_default_idx ON video_priority (user_id) WHERE is_default;
      ALTER TABLE video_priority ADD UNIQUE (user_id, label);`);
    const beforeVideos = await sql`SELECT to_jsonb(video) AS row FROM video ORDER BY video_id`;
    const beforePriorities =
      await sql`SELECT to_jsonb(video_priority) AS row FROM video_priority ORDER BY video_priority_id`;
    const migration = await readFile(
      new URL("../../../../../db/migrations/0007-video-queues.sql", import.meta.url),
      "utf8",
    );
    // The migration contains BEGIN/COMMIT; pin its connection for each execution.
    const connection = await sql.reserve();
    try {
      await connection.unsafe(migration);
      await connection.unsafe(migration);
    } finally {
      connection.release();
    }
    expect(
      await sql`SELECT to_jsonb(video) - 'video_queue_id' AS row FROM video ORDER BY video_id`,
    ).toEqual(beforeVideos);
    expect(
      await sql`SELECT to_jsonb(video_priority) - 'video_queue_id' AS row FROM video_priority ORDER BY video_priority_id`,
    ).toEqual(beforePriorities);
    const queues = await queue.listQueues(owner.id);
    expect(queues).toHaveLength(1);
    expect(
      await sql`SELECT count(*)::int AS count FROM video WHERE video_queue_id IS NULL`,
    ).toMatchObject([{ count: 0 }]);
    expect(
      await sql`SELECT count(*)::int AS count FROM video_priority WHERE video_queue_id IS NULL`,
    ).toMatchObject([{ count: 0 }]);
  });
});
