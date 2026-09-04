# 0005. Donation video scanning uses a leased PostgreSQL queue

## Status

Accepted.

## Context

The video worker previously polled `donation.videos_parsed_at IS NULL`. Multiple replicas could
therefore scan the same donation concurrently, external YouTube requests had no durable ownership,
and a process crash had no explicit retry state. A donation remains an immutable support event, and
`videos_parsed_at` remains the definition of whether its message has been scanned.

## Decision

Each unparsed donation has one `donation_video_scan` row. An `AFTER INSERT` trigger creates the row
with the donation, and every video-worker startup idempotently backfills older unparsed donations.
The queue records attempts, next availability, a bounded safe error category, completion, and a
monotonically increasing lease generation.

A worker claims one available row in a short transaction by selecting it `FOR UPDATE SKIP LOCKED`
and atomically advancing its generation and lease expiry. YouTube requests happen after that
transaction commits. Expired leases are claimable again. Completion and retry updates require both
the claimed generation and an unexpired lease, so a stale worker cannot commit after another worker
has reclaimed the donation.

Successful completion is one transaction: it validates lease ownership, inserts every supported
video idempotently, sets `donation.videos_parsed_at`, and completes the scan row. A failure rolls all
four effects back. Unsupported or invalid links are skipped; a message with no supported links is
still parsed. YouTube rate limits and transport failures use bounded exponential backoff. Process
cancellation leaves the lease untouched for expiry-based recovery and is not persisted as an error.

The queue uses PostgreSQL rather than chat JetStream because donation ingestion and video creation
already share PostgreSQL transaction boundaries, while chat event delivery is a separate domain.

## Consequences

Video replicas can scale horizontally without leader election. `SKIP LOCKED` gives each active lease
to at most one claimant, and the generation fence protects completion after lease reclamation.
Work is at-least-once, while the video uniqueness constraint and atomic completion make its durable
effects idempotent.

The startup backfill is intentionally retained even after rollout: it repairs missing queue rows
without modifying donations and is safe for concurrent replicas through `ON CONFLICT DO NOTHING`.
Completed scan rows provide operational history and are not deleted by the worker.
