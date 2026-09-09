# Video queues

A streamer has one or more named video queues and one shared set of priority thresholds, including
one zero-threshold default priority. Creating a queue does not create priorities; editing a
priority affects every queue. Labels are trimmed at the tRPC seam and unique per user.

Each video belongs to exactly one queue. Unknown duration or amount leaves its priority NULL,
not its queue. Both donation scanning and manual additions choose the user's default queue when
no queue is supplied. Changing that default never moves existing videos. Moving a video is one
update that preserves its priority, video ID, original donation, queue amount, selected segment
and watched/bookmarked state.

Private and public pages filter videos, status counts, priority counts and remaining watch time
by queue. `videoQueueId` in the URL selects a queue; omitted selection uses the default. A private
link with just `videoId` resolves the video's current queue. An explicitly unavailable queue never
falls back to another user's data. Public settings remain user-wide, and the public page offers
the user's queues as tabs. Queue names describe the streamer's workflow; Coldbrew does not infer
whether content may be broadcast on any platform.

The PostgreSQL adapter owns queue creation, updates and moves. tRPC validates input and translates
domain errors. The database selects default queues on video insertion, checks ownership, and
enforces that both a video's queue and priority belong to its owner. Priorities and currency remain
on the user rather than on a queue.

## Existing-installation migration

The dbmate migration creates and backfills the required queue identifiers before making them NOT
NULL. Stop application writers and apply the migrations for the target revision:

```sh
DBMATE_NO_DUMP_SCHEMA=true just db-migrate
```

The migration creates a `Main` queue for each existing user and associates videos with it,
including manual, donation-owned and metadata-pending videos. In the legacy schema, existing
priority IDs and all money, timing and history fields survive. If an early per-queue-priority
preview was applied, the default queue's priorities become the shared set, redundant priority rows
are removed, and every video is reassigned by the retained thresholds. The same migration handles
fresh databases after the initial schema migration.

Review and confirm the migration before running the command. Deploy the matching web and video
revisions together using the [deployment workflow](deployment.md). Do not run the old web revision
after switching the schema: its user creation does not create the required default queue.

## Verification

`postgres.integration.test.ts` exercises the queue module against PostgreSQL. Like the video
worker integration tests, it uses `VIDEO_INGEST_TEST_DATABASE_URL`, creates isolated schemas and
removes only those test schemas. Without the variable, database integration tests are skipped.
The cases cover shared thresholds, moving, unknown metadata, status preservation, default queue
changes, cross-user access, currency conversion, legacy-data backfill, and consolidation of the
early per-queue-priority preview.
