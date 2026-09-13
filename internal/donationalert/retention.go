package donationalert

import (
	"context"
	"log/slog"
	"time"
)

const (
	TerminalPlaybackRetention    = 30 * 24 * time.Hour
	MaxRetainedTerminalPlaybacks = 20
	retentionSweepEvery          = time.Hour
)

func (store *Store) PruneRetention(ctx context.Context, now time.Time) error {
	if _, err := store.pool.Exec(ctx, `
		WITH ranked AS MATERIALIZED (
			SELECT donation_alert_playback_id,
				coalesce(finished_at, created_at) AS terminal_at,
				row_number() OVER (
					PARTITION BY user_id
					ORDER BY queue_sequence DESC
				) AS recency
			FROM donation_alert_playback
			WHERE status IN ('completed', 'skipped', 'expired', 'interrupted')
		)
		DELETE FROM donation_alert_playback AS playback
		USING ranked
		WHERE playback.donation_alert_playback_id = ranked.donation_alert_playback_id
			AND (ranked.terminal_at < $1 OR ranked.recency > $2)
	`, now.Add(-TerminalPlaybackRetention), MaxRetainedTerminalPlaybacks); err != nil {
		return err
	}

	if _, err := store.pool.Exec(ctx, `
		UPDATE donation_alert_playback AS playback
		SET image_asset_id = CASE
				WHEN image_asset_id IS NOT NULL AND NOT EXISTS (
					SELECT 1
					FROM donation_alert_configuration AS configuration
					WHERE configuration.user_id = playback.user_id
						AND configuration.image_asset_id = playback.image_asset_id
				) THEN NULL
				ELSE image_asset_id
			END,
			sound_asset_id = CASE
				WHEN sound_asset_id IS NOT NULL AND NOT EXISTS (
					SELECT 1
					FROM donation_alert_configuration AS configuration
					WHERE configuration.user_id = playback.user_id
						AND configuration.sound_asset_id = playback.sound_asset_id
				) THEN NULL
				ELSE sound_asset_id
			END,
			tts_asset_id = NULL
		WHERE status IN ('completed', 'skipped', 'expired', 'interrupted')
			AND (image_asset_id IS NOT NULL OR sound_asset_id IS NOT NULL OR tts_asset_id IS NOT NULL)
	`); err != nil {
		return err
	}

	_, err := store.pool.Exec(ctx, `
		DELETE FROM donation_alert_asset AS asset
		WHERE NOT EXISTS (
				SELECT 1
				FROM donation_alert_configuration AS configuration
				WHERE configuration.image_asset_id = asset.donation_alert_asset_id
					OR configuration.sound_asset_id = asset.donation_alert_asset_id
			)
			AND NOT EXISTS (
				SELECT 1
				FROM donation_alert_playback AS playback
				WHERE playback.image_asset_id = asset.donation_alert_asset_id
					OR playback.sound_asset_id = asset.donation_alert_asset_id
					OR playback.tts_asset_id = asset.donation_alert_asset_id
			)
	`)
	return err
}

type retentionStore interface {
	PruneRetention(context.Context, time.Time) error
}

type RetentionWorker struct {
	store    retentionStore
	now      func() time.Time
	interval time.Duration
}

func NewRetentionWorker(store *Store) *RetentionWorker {
	return newRetentionWorker(store)
}

func newRetentionWorker(store retentionStore) *RetentionWorker {
	return &RetentionWorker{store: store, now: time.Now, interval: retentionSweepEvery}
}

func (worker *RetentionWorker) Run(ctx context.Context) error {
	for ctx.Err() == nil {
		if err := worker.store.PruneRetention(ctx, worker.now()); err != nil && ctx.Err() == nil {
			slog.Error("Prune donation alert history", "error", err)
		}
		timer := time.NewTimer(worker.interval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil
		case <-timer.C:
		}
	}
	return nil
}
