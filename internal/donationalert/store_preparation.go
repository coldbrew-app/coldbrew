package donationalert

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

func (store *Store) ClaimPreparation(ctx context.Context, now time.Time) (*Preparation, error) {
	var preparation Preparation
	found := false
	err := pgx.BeginFunc(ctx, store.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
			UPDATE donation_alert_playback
			SET status = 'expired',
				finished_at = $1,
				preparation_lease_expires_at = NULL,
				last_error = $2
			WHERE status IN ('preparing', 'pending') AND expires_at <= $1
		`, now, AlertExpiredDiagnostic); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE donation_alert_playback
			SET status = 'pending',
				preparation_lease_expires_at = NULL,
				last_error = $3
			WHERE status = 'preparing'
				AND expires_at > $1
				AND preparation_attempts >= $2
				AND (
					preparation_lease_expires_at IS NULL OR
					preparation_lease_expires_at <= $1
				)
		`, now, PreparationTries, TTSUnavailableDiagnostic); err != nil {
			return err
		}
		err := tx.QueryRow(ctx, `
			WITH candidate AS (
				SELECT donation_alert_playback_id
				FROM donation_alert_playback
				WHERE status = 'preparing'
					AND available_at <= $1
					AND expires_at > $1
					AND preparation_attempts < $2
					AND (
						preparation_lease_expires_at IS NULL OR
						preparation_lease_expires_at <= $1
					)
				ORDER BY queue_sequence
				FOR UPDATE SKIP LOCKED
				LIMIT 1
			)
			UPDATE donation_alert_playback AS playback
			SET preparation_generation = preparation_generation + 1,
				preparation_attempts = preparation_attempts + 1,
				preparation_lease_expires_at = $3,
				last_error = NULL
			FROM candidate
			WHERE playback.donation_alert_playback_id = candidate.donation_alert_playback_id
			RETURNING playback.donation_alert_playback_id::text,
				playback.user_id,
				playback.preparation_generation,
				playback.preparation_attempts,
				playback.message,
				playback.tts_voice
		`, now, PreparationTries, now.Add(PreparationLease)).Scan(
			&preparation.PlaybackID,
			&preparation.UserID,
			&preparation.Generation,
			&preparation.Attempts,
			&preparation.Text,
			&preparation.Voice,
		)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err == nil {
			found = true
		}
		return err
	})
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, nil //nolint:nilnil // No eligible preparation job is a successful claim result.
	}
	return &preparation, nil
}

func (store *Store) CompletePreparation(ctx context.Context, preparation Preparation, media Media, now time.Time) error {
	hash := sha256.Sum256(media.Content)
	contentHash := hex.EncodeToString(hash[:])
	return pgx.BeginFunc(ctx, store.pool, func(tx pgx.Tx) error {
		var assetID string
		var duration *int
		if media.DurationMS > 0 {
			duration = &media.DurationMS
		}
		if err := tx.QueryRow(ctx, `
			INSERT INTO donation_alert_asset (
				user_id, kind, mime_type, content, content_hash, duration_ms, created_at
			)
			VALUES ($1, 'tts', $2, $3, $4, $5, $6)
			ON CONFLICT (user_id, kind, content_hash) DO UPDATE
			SET content_hash = EXCLUDED.content_hash
			RETURNING donation_alert_asset_id::text
		`, preparation.UserID, media.MIMEType, media.Content, contentHash, duration, now).Scan(&assetID); err != nil {
			return err
		}
		command, err := tx.Exec(ctx, `
			UPDATE donation_alert_playback
			SET status = 'pending',
				tts_asset_id = $4,
				preparation_lease_expires_at = NULL,
				last_error = NULL
			WHERE donation_alert_playback_id = $1
				AND user_id = $2
				AND preparation_generation = $3
				AND status = 'preparing'
		`, preparation.PlaybackID, preparation.UserID, preparation.Generation, assetID)
		if err != nil {
			return err
		}
		if command.RowsAffected() != 1 {
			return ErrConflict
		}
		return nil
	})
}

func (store *Store) FailPreparation(ctx context.Context, preparation Preparation, _ string, now time.Time) error {
	terminal := preparation.Attempts >= PreparationTries
	command, err := store.pool.Exec(ctx, `
		UPDATE donation_alert_playback
		SET status = CASE
				WHEN expires_at <= $4 THEN 'expired'::donation_alert_playback_status
				WHEN $5 THEN 'pending'::donation_alert_playback_status
				ELSE 'preparing'::donation_alert_playback_status
			END,
			available_at = CASE
				WHEN $5 OR expires_at <= $4 THEN available_at
				ELSE least(expires_at, $6)
			END,
			finished_at = CASE WHEN expires_at <= $4 THEN $4 ELSE finished_at END,
			preparation_lease_expires_at = NULL,
			last_error = $7
		WHERE donation_alert_playback_id = $1
			AND user_id = $2
			AND preparation_generation = $3
			AND status = 'preparing'
	`, preparation.PlaybackID, preparation.UserID, preparation.Generation, now, terminal, now.Add(time.Duration(preparation.Attempts)*time.Second), TTSUnavailableDiagnostic)
	if err != nil {
		return err
	}
	if command.RowsAffected() != 1 {
		return ErrConflict
	}
	return nil
}
