# Video metadata operations

Videos are persisted before YouTube requests. Donation scanning and metadata
lookups run independently in `apps/video`. An unknown duration is NULL, and an
open segment has a NULL end until metadata arrives. Such videos remain visible
under “Без очереди”. A known segment permits priority assignment even before
the full provider duration is known.

Metadata comes from YouTube Data API v3 `videos.list`, requesting
`contentDetails.duration`, `snippet.title`, and `snippet.liveBroadcastContent`
in one request. ISO 8601 durations are normalized to positive integer seconds.
Active and upcoming live broadcasts keep an unknown duration and retry until
a final duration becomes available; their titles can be saved immediately.
Title backfills also use this API. HTML scraping, the internal player endpoint,
and oEmbed are no longer used by the video service.

Metadata jobs are durable. Automatic attempts run immediately, then after
15 seconds, 1 minute, 5 minutes, 15 minutes, 1 hour, 6 hours, and daily, with
20% jitter. A provider `Retry-After` can postpone an attempt further. Missing
metadata, network failures, 403, 429, and 5xx responses remain retryable.
Empty API results remain retryable: they do not distinguish private, deleted,
or otherwise inaccessible videos. API quota exhaustion is recorded as
`quota_exceeded` and postpones retries by at least 24 hours. Invalid/restricted
keys and disabled APIs are recorded as `api_configuration`; generic HTTP
failures retain their HTTP status. The owner can request another attempt when
access changes. Requests within one
minute of the previous attempt, or while a lease is active, do not accelerate
the job. They never reset attempt history.

## Deployment

Apply the reviewed migrations in `db/migrations` and deploy their matching application revision
using the [deployment workflow](deployment.md). Coordinate the transition:
old web code cannot parse NULL timing. Pause the old video worker during the
transition, apply the migrations, and start all application services on the matching
new revision. Do not leave mixed old/new web and worker versions running.

The worker backfills missing metadata jobs for videos with unknown duration at
startup. Existing known durations are retained. Applying migrations or deploying
does not automatically recover historical donations previously completed without
videos.

`YOUTUBE_API_KEY` is required by the video service. Enable YouTube Data API v3
in the corresponding Google Cloud project and restrict the key to
`youtube.googleapis.com`. Development uses the encrypted `.env.dev` key;
production uses GitHub's `Production` environment secret, wired into the
deployment workflow's required environment list. The development key is kept
locally; CI uses mocked YouTube responses and does not require an API key.
Refresh an existing local `.env` with `just env-init` after changing `.env.dev`.
The key is sent in a request header and is never included in URLs or logs.
This API migration does not require a database schema change.

## Inspect pending and failed metadata

These queries are read-only:

```sql
SELECT video_id, attempts, available_at, lease_expires_at, completed_at,
  last_attempt_at, last_error_code, last_http_status
FROM video_metadata_job
WHERE completed_at IS NULL OR last_error_code IS NOT NULL
ORDER BY available_at, video_id;

SELECT last_error_code, count(*) AS jobs,
  min(available_at) FILTER (WHERE completed_at IS NULL) AS oldest_pending_at
FROM video_metadata_job
GROUP BY last_error_code;
```

In Axiom, filter for `video metadata unavailable`, then `video_id`. Log fields
include attempt, error category, HTTP status, and next attempt.
`duration_unavailable` does not establish that the video is private or deleted.
Raw provider HTML and credentials are not logged.

## Repair the confirmed historical donations

Run the following read-only preview first, after verifying that the new release
is running. Review the exact IDs and existing videos before the write operation.

```sql
SELECT d.donation_id, d.message, d.videos_parsed_at,
  s.completed_at, s.lease_expires_at, count(v.video_id) AS video_count
FROM donation d
LEFT JOIN donation_video_scan s USING (donation_id)
LEFT JOIN video v USING (donation_id)
WHERE d.donation_id IN (8, 1101)
GROUP BY d.donation_id, s.completed_at, s.lease_expires_at
ORDER BY d.donation_id;
```

The following is an explicit production data repair, not part of automatic
deployment. It re-enqueues only the selected donations and will not steal an
active scan lease. The normal scanner inserts missing videos idempotently;
existing videos, owner edits, and original donation money remain unchanged.

```sql
BEGIN;
INSERT INTO donation_video_scan (donation_id)
SELECT donation_id FROM donation WHERE donation_id IN (8, 1101)
ON CONFLICT (donation_id) DO UPDATE
SET completed_at = NULL, available_at = now(), lease_expires_at = NULL
WHERE donation_video_scan.lease_expires_at IS NULL
  OR donation_video_scan.lease_expires_at <= now()
RETURNING donation_id;
COMMIT;
```

Repeat the preview to confirm a video exists for each donation. Then inspect its
metadata job; an upstream error should leave the video present and schedule a
retry. The historical `videos_parsed_at` timestamp is preserved by this repair.
