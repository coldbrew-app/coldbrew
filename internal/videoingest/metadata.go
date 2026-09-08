package videoingest

import (
	"context"
	"errors"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"net/url"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/lebedev-nikita/coldbrew/internal/youtube"
)

type metadataJob struct {
	VideoID    int64
	Generation int64
	Attempts   int
	URL        string
}

func metadataDelay(attempt int) time.Duration {
	delays := [...]time.Duration{15 * time.Second, time.Minute, 5 * time.Minute, 15 * time.Minute, time.Hour, 6 * time.Hour, 24 * time.Hour}
	return delays[min(max(attempt-1, 0), len(delays)-1)]
}

// RunMetadata is independent of donation scanning so external requests cannot
// delay persistence of new videos. Job ownership survives process restarts.
func (store *Store) RunMetadata(ctx context.Context, client *http.Client, apiKey string) error {
	_, err := store.pool.Exec(ctx, `
		INSERT INTO video_metadata_job (video_id)
		SELECT video_id FROM video WHERE duration_seconds IS NULL
		ON CONFLICT (video_id) DO NOTHING
	`)
	if err != nil {
		return err
	}
	for ctx.Err() == nil {
		worked, err := store.processMetadata(ctx, client, apiKey)
		if err != nil && ctx.Err() == nil {
			return err
		}
		if worked {
			continue
		}
		timer := time.NewTimer(2500 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
		case <-timer.C:
		}
	}
	return nil
}

func (store *Store) processMetadata(ctx context.Context, client *http.Client, apiKey string) (bool, error) {
	var job metadataJob
	err := store.pool.QueryRow(ctx, `
		WITH candidate AS (
			SELECT video_id FROM video_metadata_job
			WHERE completed_at IS NULL AND available_at <= now()
				AND (lease_expires_at IS NULL OR lease_expires_at <= now())
			ORDER BY available_at, video_id
			FOR UPDATE SKIP LOCKED LIMIT 1
		), claimed AS (
			UPDATE video_metadata_job AS job
			SET generation = generation + 1, attempts = attempts + 1,
				last_attempt_at = now(), lease_expires_at = now() + interval '2 minutes'
			FROM candidate WHERE job.video_id = candidate.video_id
			RETURNING job.video_id, job.generation, job.attempts
		)
		SELECT claimed.video_id, generation, attempts, video.url
		FROM claimed JOIN video USING (video_id)
	`).Scan(&job.VideoID, &job.Generation, &job.Attempts, &job.URL)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}

	// Fetch a canonical watch URL: source segment parameters must not constrain
	// the duration lookup or overwrite current user-selected boundaries.
	id, ok := youtube.VideoID(job.URL)
	if !ok {
		return true, errors.New("stored video has invalid provider URL")
	}
	timing, lookupErr := youtube.GetTiming(ctx, client, apiKey, "https://www.youtube.com/watch?v="+url.QueryEscape(id), nil)
	if ctx.Err() != nil {
		return true, nil
	}
	title := timing.Title

	code := ""
	var status *int
	nextAttempt := time.Now()
	if lookupErr != nil {
		code = "duration_unavailable"
		delay := time.Duration(float64(metadataDelay(job.Attempts)) * (0.8 + rand.Float64()*0.4))
		var httpError *youtube.HTTPError
		var transport *youtube.TransportError
		switch {
		case errors.As(lookupErr, &httpError):
			code, status = "http_failure", &httpError.Status
			if httpError.Reason != "" {
				code = httpError.Reason
			}
			delay = max(delay, httpError.RetryAfter)
		case errors.As(lookupErr, &transport):
			code = "transport_failure"
		}
		nextAttempt = nextAttempt.Add(delay)
		slog.Warn("video metadata unavailable", "video_id", job.VideoID, "provider_video_id", id,
			"attempt", job.Attempts, "error_code", code, "http_status", func() any {
				if status == nil {
					return nil
				}
				return *status
			}(),
			"next_attempt_at", nextAttempt)
	}

	err = pgx.BeginFunc(ctx, store.pool, func(tx pgx.Tx) error {
		result, err := tx.Exec(ctx, `
			UPDATE video_metadata_job
			SET lease_expires_at = NULL,
				completed_at = CASE WHEN $3 THEN now() ELSE NULL END,
				available_at = $4, last_error_code = nullif($5, ''), last_http_status = $6
			WHERE video_id = $1 AND generation = $2
				AND completed_at IS NULL AND lease_expires_at > now()
		`, job.VideoID, job.Generation, lookupErr == nil, nextAttempt, code, status)
		if err != nil {
			return err
		}
		if result.RowsAffected() == 0 {
			return nil
		}
		if lookupErr != nil {
			_, err = tx.Exec(ctx, `UPDATE video SET title = coalesce(title, nullif($2, '')) WHERE video_id = $1`, job.VideoID, title)
			return err
		}
		// This update locks and reads the current row, preserving edits made while
		// HTTP was in flight. No stale queue amount is written by this worker.
		_, err = tx.Exec(ctx, `
			UPDATE video
			SET duration_seconds = $2::integer,
				end_seconds = CASE WHEN start_seconds < $2 THEN least(coalesce(end_seconds, $2), $2) ELSE end_seconds END,
				title = coalesce(title, nullif($3, ''))
			WHERE video_id = $1
		`, job.VideoID, timing.DurationSeconds, title)
		return err
	})
	return true, err
}
