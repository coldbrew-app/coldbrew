package donationalert

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// EnqueueIncoming snapshots a newly inserted donation and the current alert
// configuration in the caller's transaction. Initial history callers must not
// call this method.
func EnqueueIncoming(ctx context.Context, tx pgx.Tx, userID int, donationID int64, source Source, acceptedAt time.Time) error {
	locked, err := lockAlertQueue(ctx, tx, userID)
	if err != nil || !locked {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO donation_alert_playback (
			user_id,
			donation_id,
			kind,
			status,
			source,
			author,
			message,
			amount,
			currency,
			image_asset_id,
			sound_asset_id,
			display_duration_ms,
			sound_volume,
			tts_volume,
			tts_voice,
			accent_color,
			created_at,
			available_at,
			expires_at
		)
		SELECT donation.user_id,
			donation.donation_id,
			'incoming',
			CASE
				WHEN configuration.tts_enabled AND nullif(trim(donation.message), '') IS NOT NULL
					THEN 'preparing'::donation_alert_playback_status
				ELSE 'pending'::donation_alert_playback_status
			END,
			donation.source,
			nullif(left(trim(donation.author), $6), ''),
			left(donation.message, $7),
			donation.amount,
			donation.currency,
			configuration.image_asset_id,
			configuration.sound_asset_id,
			configuration.display_duration_ms,
			configuration.sound_volume,
			configuration.tts_volume,
			configuration.tts_voice,
			configuration.accent_color,
			$4::timestamptz,
			$4::timestamptz,
			least(
				$4::timestamptz + make_interval(secs => $5::double precision),
				donation.occurred_at + make_interval(secs => $5::double precision)
			)
		FROM donation
		JOIN donation_alert_configuration AS configuration USING (user_id)
		JOIN donation_alert_source AS alert_source
			ON alert_source.user_id = donation.user_id AND alert_source.source = donation.source
		WHERE donation.donation_id = $2
			AND donation.user_id = $1
			AND donation.source = $3
			AND configuration.enabled
			AND alert_source.enabled
			AND donation.occurred_at > $4::timestamptz - make_interval(secs => $5::double precision) + interval '1 millisecond'
		ON CONFLICT (donation_id) WHERE kind = 'incoming' DO NOTHING
	`, userID, donationID, source, acceptedAt, int(MaxAlertAge/time.Second), MaxAlertAuthorRunes, MaxAlertMessageRunes); err != nil {
		return err
	}
	return boundBacklog(ctx, tx, userID, acceptedAt)
}

// lockAlertQueue serializes queue sequence allocation, backlog trimming, and
// playback claims for one user. Without this row lock a claim can miss a
// lower-sequence row that another transaction has inserted but not committed.
func lockAlertQueue(ctx context.Context, tx pgx.Tx, userID int) (bool, error) {
	err := lockConfiguration(ctx, tx, userID)
	if errors.Is(err, ErrNotFound) {
		return false, nil
	}
	return err == nil, err
}

func boundBacklog(ctx context.Context, tx pgx.Tx, userID int, now time.Time) error {
	_, err := tx.Exec(ctx, `
		WITH overflow AS (
			SELECT donation_alert_playback_id
			FROM donation_alert_playback
			WHERE user_id = $1 AND status IN ('preparing', 'pending')
			ORDER BY queue_sequence DESC
			OFFSET $2
		)
		UPDATE donation_alert_playback
		SET status = 'expired',
			finished_at = $3,
			preparation_lease_expires_at = NULL,
			last_error = $4
		FROM overflow
		WHERE donation_alert_playback.donation_alert_playback_id = overflow.donation_alert_playback_id
	`, userID, MaxPendingAlerts, now, BacklogLimitDiagnostic)
	return err
}

func (store *Store) CreateTest(ctx context.Context, userID int, now time.Time) (*Playback, error) {
	var playbackID string
	err := pgx.BeginFunc(ctx, store.pool, func(tx pgx.Tx) error {
		if err := ensureConfiguration(ctx, tx, userID); err != nil {
			return err
		}
		if _, err := lockAlertQueue(ctx, tx, userID); err != nil {
			return err
		}
		err := tx.QueryRow(ctx, `
			INSERT INTO donation_alert_playback (
				user_id,
				kind,
				status,
				author,
				message,
				amount,
				currency,
				image_asset_id,
				sound_asset_id,
				display_duration_ms,
				sound_volume,
				tts_volume,
				tts_voice,
				accent_color,
				created_at,
				available_at,
				expires_at
			)
			SELECT user_id,
				'test',
				CASE WHEN tts_enabled THEN 'preparing'::donation_alert_playback_status
					ELSE 'pending'::donation_alert_playback_status END,
				'Coldbrew',
				'This is a test donation alert.',
				500,
				'RUB',
				image_asset_id,
				sound_asset_id,
				display_duration_ms,
				sound_volume,
				tts_volume,
				tts_voice,
				accent_color,
				$2,
				$2,
				$3
			FROM donation_alert_configuration
			WHERE user_id = $1
			RETURNING donation_alert_playback_id::text
		`, userID, now, now.Add(MaxAlertAge)).Scan(&playbackID)
		if err != nil {
			return err
		}
		return boundBacklog(ctx, tx, userID, now)
	})
	if err != nil {
		return nil, err
	}
	return store.Playback(ctx, playbackID)
}

func (store *Store) Replay(ctx context.Context, userID int, sourcePlaybackID string, now time.Time) (*Playback, error) {
	var playbackID string
	err := pgx.BeginFunc(ctx, store.pool, func(tx pgx.Tx) error {
		if err := ensureConfiguration(ctx, tx, userID); err != nil {
			return err
		}
		if _, err := lockAlertQueue(ctx, tx, userID); err != nil {
			return err
		}
		err := tx.QueryRow(ctx, `
			INSERT INTO donation_alert_playback (
				user_id,
				donation_id,
				kind,
				status,
				source,
				author,
				message,
				amount,
				currency,
				image_asset_id,
				sound_asset_id,
				display_duration_ms,
				sound_volume,
				tts_volume,
				tts_voice,
				accent_color,
				created_at,
				available_at,
				expires_at
			)
			SELECT source_playback.user_id,
				source_playback.donation_id,
				'replay',
				CASE
					WHEN configuration.tts_enabled AND nullif(trim(source_playback.message), '') IS NOT NULL
						THEN 'preparing'::donation_alert_playback_status
					ELSE 'pending'::donation_alert_playback_status
				END,
				source_playback.source,
				nullif(left(trim(source_playback.author), $5), ''),
				left(source_playback.message, $6),
				source_playback.amount,
				source_playback.currency,
				configuration.image_asset_id,
				configuration.sound_asset_id,
				configuration.display_duration_ms,
				configuration.sound_volume,
				configuration.tts_volume,
				configuration.tts_voice,
				configuration.accent_color,
				$3,
				$3,
				$4
			FROM donation_alert_playback AS source_playback
			JOIN donation_alert_configuration AS configuration
				ON configuration.user_id = source_playback.user_id
			WHERE source_playback.donation_alert_playback_id = $2
				AND source_playback.user_id = $1
				AND source_playback.donation_id IS NOT NULL
				AND source_playback.status IN ('completed', 'skipped', 'expired', 'interrupted')
			RETURNING donation_alert_playback_id::text
		`, userID, sourcePlaybackID, now, now.Add(MaxAlertAge), MaxAlertAuthorRunes, MaxAlertMessageRunes).Scan(&playbackID)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		return boundBacklog(ctx, tx, userID, now)
	})
	if err != nil {
		return nil, err
	}
	return store.Playback(ctx, playbackID)
}

func (store *Store) Playback(ctx context.Context, playbackID string) (*Playback, error) {
	playback, err := scanPlayback(store.pool.QueryRow(ctx, playbackSelect+`
		WHERE donation_alert_playback_id = $1
	`, playbackID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return playback, err
}

func (store *Store) Skip(ctx context.Context, userID int, now time.Time) (*string, error) {
	var playbackID string
	found := false
	err := pgx.BeginFunc(ctx, store.pool, func(tx pgx.Tx) error {
		locked, err := lockAlertQueue(ctx, tx, userID)
		if err != nil || !locked {
			return err
		}
		err = tx.QueryRow(ctx, `
			WITH candidate AS (
				SELECT donation_alert_playback_id
				FROM donation_alert_playback
				WHERE user_id = $1 AND status IN ('playing', 'pending', 'preparing')
				ORDER BY (status = 'playing') DESC, queue_sequence
				FOR UPDATE
				LIMIT 1
			)
			UPDATE donation_alert_playback
			SET status = 'skipped',
				finished_at = $2,
				preparation_lease_expires_at = NULL
			FROM candidate
			WHERE donation_alert_playback.donation_alert_playback_id = candidate.donation_alert_playback_id
			RETURNING donation_alert_playback.donation_alert_playback_id::text
		`, userID, now).Scan(&playbackID)
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
		return nil, nil //nolint:nilnil // An empty queue is a successful skip with no playback.
	}
	return &playbackID, nil
}
