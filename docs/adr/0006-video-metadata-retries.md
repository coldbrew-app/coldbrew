# 0006. Save videos before fetching metadata

## Status

Accepted. Implementation and schema changes approved by the user. Production
schema application and historical data repair are separate rollout operations.

## Problem

The production scan for donation 1101 extracted a supported YouTube URL but
received `youtube: duration not found`. The worker skipped the video and marked
the donation parsed. Retrying donation scans alone cannot repair completed scans.

## Behavior

Donation scanning performs no YouTube requests. It normalizes supported links,
extracts provider video IDs, and atomically inserts videos, creates metadata jobs,
and completes the donation scan. `videos_parsed_at` means the message was scanned
and its supported links were persisted; it does not mean metadata is available.
Malformed links without a valid provider video ID remain excluded.

Every supported video is visible immediately, even if YouTube is unreachable,
requires authentication, or cannot provide a duration. Unknown values are NULL,
never zero or an invented duration. A title lookup may succeed independently of
the duration lookup. A title failure must not discard a successful duration.

Manual videos use the same transactional insertion and metadata-job path, without
creating a donation. Existing explicit segment validation remains in place.

## Schema

- Make `video.duration_seconds` nullable: NULL means the provider duration is unknown.
- Make `video.end_seconds` nullable: NULL means the segment ends at the as-yet
  unknown end of the video. An explicit end remains stored even while duration
  is unknown. Retain `end_seconds > start_seconds` whenever end is non-NULL.
- Add `video_metadata_job`, keyed by `video_id`, with a cascading foreign key to
  video. Fields: `generation`, `attempts`, `available_at`, `lease_expires_at`,
  `completed_at`, `last_attempt_at`, `last_error_code`, and `last_http_status`.
  Use the existing donation-scan lease constraints and a partial due-jobs index.
- Add no currency to videos or jobs. Keep the converted `queue_amount` on video.
- Adapt the priority trigger: an unknown segment end or NULL queue amount yields
  NULL `video_priority_id`. A known valid segment uses the existing threshold rule.

A job is pending when `completed_at` is NULL and otherwise complete. There is no
second stored status that can contradict these fields. The API exposes nullable
duration, an unavailable flag, and the next automatic attempt time to the owner.

## Queue and interface

Show pending videos in `/videos`, donation video chips, and the public video queue
when enabled. Include a selectable “Без очереди” group for videos without a video
priority so that filtering does not hide them. Show “Длительность уточняется”
while retries continue, or “Не удалось получить длительность” after a terminal
failure. Explain unsupported money separately from missing watch time.

Playback, bookmarks, and marking watched work without duration. Omit the embed
end parameter when unknown. Do not pass NULL through duration formatters or show
it as zero. Per-priority totals contain only assigned videos with known watch time. Videos
without an assignment appear in the separate unassigned group and its owner-side
counter, rather than contributing a fabricated zero to a duration total.

A valid explicitly selected end permits calculation of watch time and priority
even when the full provider duration remains unknown. With an open end, assign
priority only after metadata resolves it. Assignment uses the current stored
queue amount and current priority thresholds. Currency changes continue to
convert that amount normally; the metadata worker never reconverts the donation.

Expose nullable timing and a safe metadata status through both private and public
TypeScript contracts. Expose next retry time and a “Повторить” action only to the
owner. This action makes an existing job due without resetting attempt history,
duplicating it, or stealing an active lease. Rate-limit it per video and owner.

## Metadata worker

Run donation scans and metadata processing in independent loops in `apps/video`.
A slow YouTube request must not prevent newly received donations from being scanned.
Begin with one metadata request in flight per process and a 30-second request
timeout. Use two-minute leases, `FOR UPDATE SKIP LOCKED`, and generation fencing
as in the existing scan worker. Database transactions never span HTTP requests.

The first metadata attempt is due immediately. Retry transient or ambiguous
failures with delays of 15 seconds, 1 minute, 5 minutes, 15 minutes, 1 hour,
6 hours, then every 24 hours. Apply approximately 20% jitter and respect a valid
provider `Retry-After` as the minimum delay. Ambiguous failures continue daily
until success, deletion, or a positively identified terminal provider result.

Retry transport failures, timeouts, HTTP 429, HTTP 5xx, missing duration,
unrecognized responses, consent/bot challenges, and ambiguous HTTP 403 responses.
HTTP status alone must not be interpreted as proof that a video was deleted.
Stop automatic retries only for an explicit provider result identifying a deleted
or private video. This means YouTube explicitly reports current unavailability,
not that the video can never become available again. Keep the video and allow
an owner-triggered retry because provider availability can change.

Persist a bounded error category and HTTP status on every failed attempt. Log
video ID, provider video ID, attempt number, result category, provider playability
reason when safe, and next retry time. Do not log raw HTML, cookies, or tokens.
Pending jobs, oldest due time, error categories, and terminal failures can be
inspected using the queries in [the operations guide](../video-metadata.md).

On success, atomically verify the lease, write duration, fill a missing title,
resolve an open end, and complete the job. Read current video timing under lock;
do not overwrite user edits made while the request was running. If an explicit
end exceeds the retrieved duration, clamp it to duration only when the result
remains after start. If start is outside the provider duration, keep the selected
range, store the known duration, expose “Проверьте границы видео”, and leave the
video unassigned until the owner corrects it. Extend the priority trigger to
detect this case and run on duration updates as well as segment changes.

A completed metadata update must not reassign an already valid priority merely
because title or duration was filled. Resolve/reassign only when effective timing
or its validity changes. Watched and bookmarked state remain independent.

Restarted workers reclaim expired leases. A failed database write rolls back the
metadata update and job completion together. Cancellation leaves recovery to lease
expiry. Multiple copies of a provider video have independent jobs initially;
cross-video caching and shared provider throttling are separate optimizations.

## Rollout and recovery

Implement nullable timing across Go, SQL, tRPC contracts, owner/public views, and
editing before enabling the new ingestion path. Existing known durations remain
unchanged. Schema application requires a coordinated release because old clients
and worker versions assume non-NULL timing.

Backfill metadata jobs for existing videos with unknown duration. This does not
recover donations previously marked parsed with no video. The operations guide
provides a read-only preview and an explicitly invoked repair that re-enqueues
selected donation IDs and inserts missing videos/jobs idempotently. It targets
the confirmed affected donations 8 and 1101;
do not automatically rescan every historical donation or alter original money.
Production repair is a separate data operation after the release is verified.

Keep URL start-offset behavior unchanged in this change. The current tests
explicitly expect zero for `t=13s`; changing that product behavior needs a separate
decision rather than treating it as part of metadata recovery.

## Acceptance checks

- The exact message from donation 1101 creates one video before any HTTP request.
- Missing duration, HTTP 429/503, and transport failures keep that video visible
  and persist a future retry; a later successful attempt updates the same video.
- Explicit unavailability stops automatic retries but leaves the video visible.
- Duplicate scans, worker crashes, expired leases, and concurrent workers cannot
  duplicate videos or allow stale metadata writes.
- A user edit during lookup is preserved; a currency change uses the current
  queue amount; filling title alone does not alter an existing priority.
- Open ends, explicit ends, and starts outside duration render correctly, including
  owner/public lists, filters, counters, embeds, editing, and watch-time summaries.
- Restart recovery and atomic completion are verified against PostgreSQL using
  the real constraints and priority trigger, not a reduced test schema.
