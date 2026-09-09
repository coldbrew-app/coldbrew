# Video queues

A streamer has one or more named video queues. Each queue owns independent priority thresholds,
including one zero-threshold default priority. New queues copy the current default queue's
priorities; later edits affect only the selected queue. Labels are trimmed at the tRPC seam and
unique per user (queue names) or queue (priority names).

Each video belongs to exactly one queue. Unknown duration or amount leaves its priority NULL,
not its queue. Both donation scanning and manual additions choose the user's default queue when
no queue is supplied. Changing that default never moves existing videos. Moving a video is one
update: the database recalculates priority using the destination's thresholds and retains the
video ID, original donation, queue amount, selected segment and watched/bookmarked state.

Private and public pages filter videos, status counts, priority counts and remaining watch time
by queue. `videoQueueId` in the URL selects a queue; omitted selection uses the default. A private
link with just `videoId` resolves the video's current queue. An explicitly unavailable queue never
falls back to another user's data. Public settings remain user-wide, and the public page offers
the user's queues as tabs. Queue names describe the streamer's workflow; Coldbrew does not infer
whether content may be broadcast on any platform.

The PostgreSQL adapter owns queue creation, updates and moves. tRPC validates input and translates
domain errors. The database selects default queues on video insertion, checks ownership, and
enforces that a video's priority belongs to its queue. `video_priority.user_id` is retained as an
ownership key and constrained together with `video_queue_id`; currency remains on `"user"`.

## Existing-installation migration

The final schema adds NOT NULL queue identifiers. Applying it directly to populated old tables
will fail. Stop application writers, then backfill before applying the final schema:

```sh
bunx dotenvx run -f .env --overload -- sh -c 'psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f db/migrations/0007-video-queues.sql'
just schema-apply
```

The migration creates a `Main` queue for each existing user and associates existing priorities and
videos with it, including manual, donation-owned and metadata-pending videos. Existing priority
IDs and all money, timing and history fields survive. The backfill can be rerun; it does not
overwrite existing queue assignments. Fresh databases need only `db/schema.sql`.

Review and confirm schema application before running these commands. Deploy the matching web and
video revisions together using the [deployment workflow](deployment.md). Do not run the old web
revision after switching the schema: its user creation does not create the required default queue.

## Verification

`postgres.integration.test.ts` exercises the queue module against PostgreSQL. Like the video
worker integration tests, it uses `VIDEO_INGEST_TEST_DATABASE_URL`, creates isolated schemas and
removes only those test schemas. Without the variable, database integration tests are skipped.
The cases cover independent thresholds, moving, unknown metadata, status preservation, default
queue changes, cross-user access, currency conversion, and idempotent legacy-data backfill.
