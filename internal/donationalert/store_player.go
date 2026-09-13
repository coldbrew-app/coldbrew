package donationalert

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

func (store *Store) OpenPlayer(ctx context.Context, tokenHash, candidateID string, now time.Time) (int, Player, error) {
	var userID int
	var result Player
	err := pgx.BeginFunc(ctx, store.pool, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `
			SELECT user_id
			FROM donation_alert_overlay
			WHERE token_hash = $1
			FOR UPDATE
		`, tokenHash).Scan(&userID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrInvalidToken
			}
			return err
		}

		var currentID string
		var currentGeneration int64
		var active, visible bool
		var lastSeen, leaseExpires time.Time
		err := tx.QueryRow(ctx, `
			SELECT player_id::text, generation, active, visible, last_seen_at, lease_expires_at
			FROM donation_alert_player
			WHERE user_id = $1
			FOR UPDATE
		`, userID).Scan(&currentID, &currentGeneration, &active, &visible, &lastSeen, &leaseExpires)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if err == nil && leaseExpires.After(now) {
			result = Player{
				PlayerID: candidateID, Generation: currentGeneration, State: "standby",
				Active: active, Visible: visible, LastHeartbeatAt: lastSeen,
				LeaseExpiresAt: leaseExpires,
			}
			return nil
		}
		if err == nil {
			if recoverErr := recoverAssignedPlayback(ctx, tx, userID, currentID, currentGeneration, now, PlayerDisconnectedDiagnostic); recoverErr != nil {
				return recoverErr
			}
		}
		var generation int64
		err = tx.QueryRow(ctx, `
			INSERT INTO donation_alert_player (
				user_id, player_id, generation, active, visible,
				connected_at, last_seen_at, lease_expires_at
			)
			VALUES ($1, $2, 1, false, false, $3, $3, $4)
			ON CONFLICT (user_id) DO UPDATE
			SET player_id = EXCLUDED.player_id,
				generation = donation_alert_player.generation + 1,
				active = false,
				visible = false,
				connected_at = EXCLUDED.connected_at,
				last_seen_at = EXCLUDED.last_seen_at,
				lease_expires_at = EXCLUDED.lease_expires_at
			RETURNING generation
		`, userID, candidateID, now, now.Add(PlayerLease)).Scan(&generation)
		if err != nil {
			return err
		}
		result = Player{
			PlayerID: candidateID, Generation: generation, State: "active", Active: false, Visible: false,
			LastHeartbeatAt: now, LeaseExpiresAt: now.Add(PlayerLease),
		}
		return nil
	})
	return userID, result, err
}

// recoverAssignedPlayback releases the work owned by a player. A claim does
// not become a delivery until the renderer acknowledges its start. Therefore
// fresh, unstarted work is returned to the queue, while acknowledged work is
// terminal so a donation is never rendered twice after an uncertain failure.
func recoverAssignedPlayback(
	ctx context.Context,
	tx pgx.Tx,
	userID int,
	playerID string,
	generation int64,
	now time.Time,
	reason DiagnosticCode,
) error {
	_, err := tx.Exec(ctx, `
		UPDATE donation_alert_playback
		SET status = CASE
				WHEN started_at IS NULL AND expires_at > $4
					THEN 'pending'::donation_alert_playback_status
				WHEN started_at IS NULL
					THEN 'expired'::donation_alert_playback_status
				ELSE 'interrupted'::donation_alert_playback_status
			END,
			finished_at = CASE
				WHEN started_at IS NULL AND expires_at > $4 THEN NULL
				ELSE $4
			END,
			player_id = CASE WHEN started_at IS NULL THEN NULL ELSE player_id END,
			player_generation = CASE WHEN started_at IS NULL THEN NULL ELSE player_generation END,
			last_error = CASE
				WHEN started_at IS NULL AND expires_at > $4 THEN NULL
				WHEN started_at IS NULL THEN $6
				ELSE $5
			END
		WHERE user_id = $1
			AND player_id = $2
			AND player_generation = $3
			AND status = 'playing'
	`, userID, playerID, generation, now, reason, AlertExpiredDiagnostic)
	return err
}

func recoverUserPlayback(ctx context.Context, tx pgx.Tx, userID int, now time.Time, reason DiagnosticCode) error {
	_, err := tx.Exec(ctx, `
		UPDATE donation_alert_playback
		SET status = CASE
				WHEN started_at IS NULL AND expires_at > $2
					THEN 'pending'::donation_alert_playback_status
				WHEN started_at IS NULL
					THEN 'expired'::donation_alert_playback_status
				ELSE 'interrupted'::donation_alert_playback_status
			END,
			finished_at = CASE
				WHEN started_at IS NULL AND expires_at > $2 THEN NULL
				ELSE $2
			END,
			player_id = CASE WHEN started_at IS NULL THEN NULL ELSE player_id END,
			player_generation = CASE WHEN started_at IS NULL THEN NULL ELSE player_generation END,
			last_error = CASE
				WHEN started_at IS NULL AND expires_at > $2 THEN NULL
				WHEN started_at IS NULL THEN $4
				ELSE $3
			END
		WHERE user_id = $1 AND status = 'playing'
	`, userID, now, reason, AlertExpiredDiagnostic)
	return err
}

func recoverTimedOutPlayback(ctx context.Context, tx pgx.Tx, userID int, now time.Time) error {
	_, err := tx.Exec(ctx, `
		UPDATE donation_alert_playback
		SET status = CASE
				WHEN started_at IS NULL THEN 'expired'::donation_alert_playback_status
				ELSE 'interrupted'::donation_alert_playback_status
			END,
			finished_at = $2,
			player_id = CASE WHEN started_at IS NULL THEN NULL ELSE player_id END,
			player_generation = CASE WHEN started_at IS NULL THEN NULL ELSE player_generation END,
			last_error = CASE
				WHEN started_at IS NULL THEN $4
				ELSE $3
			END
		WHERE user_id = $1
			AND status = 'playing'
			AND (
				(started_at IS NULL AND expires_at <= $2) OR
				(started_at IS NOT NULL AND started_at <= $2 - make_interval(secs => $5::double precision))
			)
	`, userID, now, PlaybackTimeoutDiagnostic, AlertExpiredDiagnostic, int(PlaybackAcknowledgementTimeout/time.Second))
	return err
}

func (store *Store) Heartbeat(ctx context.Context, tokenHash, playerID string, generation int64, active, visible bool, now time.Time) error {
	leaseLost := false
	err := pgx.BeginFunc(ctx, store.pool, func(tx pgx.Tx) error {
		var userID int
		var leaseExpires time.Time
		err := tx.QueryRow(ctx, `
			SELECT player.user_id, player.lease_expires_at
			FROM donation_alert_player AS player
			JOIN donation_alert_overlay AS overlay USING (user_id)
			WHERE overlay.token_hash = $1
				AND player.player_id = $2
				AND player.generation = $3
			FOR UPDATE OF player
		`, tokenHash, playerID, generation).Scan(&userID, &leaseExpires)
		if errors.Is(err, pgx.ErrNoRows) {
			leaseLost = true
			return nil
		}
		if err != nil {
			return err
		}
		if !leaseExpires.After(now) {
			if err := recoverAssignedPlayback(ctx, tx, userID, playerID, generation, now, PlayerDisconnectedDiagnostic); err != nil {
				return err
			}
			leaseLost = true
			return nil
		}
		if _, err := tx.Exec(ctx, `
			UPDATE donation_alert_player
			SET active = $4,
				visible = $5,
				last_seen_at = $6,
				lease_expires_at = $7
			WHERE user_id = $1 AND player_id = $2 AND generation = $3
		`, userID, playerID, generation, active, visible, now, now.Add(PlayerLease)); err != nil {
			return err
		}
		if !active || !visible {
			return recoverAssignedPlayback(ctx, tx, userID, playerID, generation, now, PlayerDisconnectedDiagnostic)
		}
		return nil
	})
	if err != nil {
		return err
	}
	if leaseLost {
		return ErrLeaseLost
	}
	return nil
}

func (store *Store) ReleasePlayer(ctx context.Context, tokenHash, playerID string, generation int64, now time.Time) error {
	return pgx.BeginFunc(ctx, store.pool, func(tx pgx.Tx) error {
		var userID int
		err := tx.QueryRow(ctx, `
			SELECT player.user_id
			FROM donation_alert_overlay AS overlay
			JOIN donation_alert_player AS player USING (user_id)
			WHERE overlay.token_hash = $1
				AND player.player_id = $2
				AND player.generation = $3
			FOR UPDATE OF overlay, player
		`, tokenHash, playerID, generation).Scan(&userID)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		if recoverErr := recoverAssignedPlayback(ctx, tx, userID, playerID, generation, now, PlayerDisconnectedDiagnostic); recoverErr != nil {
			return recoverErr
		}
		_, err = tx.Exec(ctx, `
			DELETE FROM donation_alert_player
			WHERE user_id = $1 AND player_id = $2 AND generation = $3
		`, userID, playerID, generation)
		return err
	})
}

func (store *Store) ClaimPlayback(ctx context.Context, tokenHash, playerID string, generation int64, now time.Time) (*Playback, error) {
	var playbackID string
	leaseLost := false
	err := pgx.BeginFunc(ctx, store.pool, func(tx pgx.Tx) error {
		var userID int
		err := tx.QueryRow(ctx, `
			SELECT user_id
			FROM donation_alert_overlay
			WHERE token_hash = $1
		`, tokenHash).Scan(&userID)
		if errors.Is(err, pgx.ErrNoRows) {
			leaseLost = true
			return nil
		}
		if err != nil {
			return err
		}
		locked, err := lockAlertQueue(ctx, tx, userID)
		if err != nil {
			return err
		}
		if !locked {
			leaseLost = true
			return nil
		}
		var active, visible, paused bool
		var leaseExpires time.Time
		err = tx.QueryRow(ctx, `
			SELECT player.user_id, player.active, player.visible,
				configuration.paused, player.lease_expires_at
			FROM donation_alert_player AS player
			JOIN donation_alert_overlay AS overlay USING (user_id)
			JOIN donation_alert_configuration AS configuration USING (user_id)
			WHERE overlay.token_hash = $1
				AND player.player_id = $2
				AND player.generation = $3
			FOR UPDATE OF player
		`, tokenHash, playerID, generation).Scan(&userID, &active, &visible, &paused, &leaseExpires)
		if errors.Is(err, pgx.ErrNoRows) {
			leaseLost = true
			return nil
		}
		if err != nil {
			return err
		}
		if !leaseExpires.After(now) {
			if recoverErr := recoverAssignedPlayback(ctx, tx, userID, playerID, generation, now, PlayerDisconnectedDiagnostic); recoverErr != nil {
				return recoverErr
			}
			leaseLost = true
			return nil
		}
		if recoverErr := recoverTimedOutPlayback(ctx, tx, userID, now); recoverErr != nil {
			return recoverErr
		}
		if _, execErr := tx.Exec(ctx, `
			UPDATE donation_alert_playback
			SET status = 'expired',
				finished_at = $2,
				preparation_lease_expires_at = NULL,
				last_error = $3
			WHERE user_id = $1
				AND status IN ('preparing', 'pending')
				AND expires_at <= $2
		`, userID, now, AlertExpiredDiagnostic); execErr != nil {
			return execErr
		}
		if !active || !visible || paused {
			return nil
		}
		err = tx.QueryRow(ctx, `
			WITH candidate AS (
				SELECT pending.donation_alert_playback_id
				FROM donation_alert_playback AS pending
				WHERE pending.user_id = $1
					AND pending.status = 'pending'
					AND pending.available_at <= $4
					AND pending.expires_at > $4
					AND NOT EXISTS (
						SELECT 1
						FROM donation_alert_playback AS playing
						WHERE playing.user_id = $1 AND playing.status = 'playing'
					)
					AND NOT EXISTS (
						SELECT 1
						FROM donation_alert_playback AS earlier
						WHERE earlier.user_id = pending.user_id
							AND earlier.status IN ('preparing', 'pending')
							AND earlier.expires_at > $4
							AND earlier.queue_sequence < pending.queue_sequence
					)
				ORDER BY pending.queue_sequence
				FOR UPDATE SKIP LOCKED
				LIMIT 1
			)
			UPDATE donation_alert_playback
			SET status = 'playing',
				player_id = $2,
				player_generation = $3
			FROM candidate
			WHERE donation_alert_playback.donation_alert_playback_id = candidate.donation_alert_playback_id
			RETURNING donation_alert_playback.donation_alert_playback_id::text
		`, userID, playerID, generation, now).Scan(&playbackID)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return err
	})
	if err != nil {
		return nil, err
	}
	if leaseLost {
		return nil, ErrLeaseLost
	}
	if playbackID == "" {
		return nil, nil //nolint:nilnil // An empty eligible queue is a successful claim with no playback.
	}
	return store.Playback(ctx, playbackID)
}

func (store *Store) StartPlayback(ctx context.Context, tokenHash, playerID string, generation int64, playbackID string, now time.Time) error {
	command, err := store.pool.Exec(ctx, `
		UPDATE donation_alert_playback AS playback
		SET started_at = coalesce(started_at, $5)
		FROM donation_alert_player AS player
		JOIN donation_alert_overlay AS overlay USING (user_id)
		WHERE overlay.token_hash = $1
			AND player.player_id = $2
			AND player.generation = $3
			AND player.lease_expires_at > $5
			AND playback.donation_alert_playback_id = $4
			AND playback.user_id = player.user_id
			AND playback.player_id = player.player_id
			AND playback.player_generation = player.generation
			AND playback.status = 'playing'
	`, tokenHash, playerID, generation, playbackID, now)
	if err != nil {
		return err
	}
	if command.RowsAffected() != 1 {
		return ErrLeaseLost
	}
	return nil
}

func (store *Store) FinishPlayback(ctx context.Context, tokenHash, playerID string, generation int64, playbackID string, outcome FinishOutcome, now time.Time) error {
	if outcome != FinishCompleted && outcome != FinishInterrupted {
		return errors.New("invalid playback outcome")
	}
	statement := `
		UPDATE donation_alert_playback AS playback
		SET status = 'completed',
			finished_at = coalesce(finished_at, $5),
			last_error = playback.last_error
		FROM donation_alert_player AS player
		JOIN donation_alert_overlay AS overlay USING (user_id)
		WHERE overlay.token_hash = $1
			AND player.player_id = $2
			AND player.generation = $3
			AND player.lease_expires_at > $5
			AND playback.donation_alert_playback_id = $4
			AND playback.user_id = player.user_id
			AND playback.player_id = player.player_id
			AND playback.player_generation = player.generation
			AND playback.started_at IS NOT NULL
			AND playback.status IN ('playing', 'completed')
	`
	arguments := []any{tokenHash, playerID, generation, playbackID, now}
	if outcome == FinishInterrupted {
		statement = `
			UPDATE donation_alert_playback AS playback
			SET status = CASE
					WHEN playback.started_at IS NULL AND playback.expires_at > $5
						THEN 'pending'::donation_alert_playback_status
					WHEN playback.started_at IS NULL
						THEN 'expired'::donation_alert_playback_status
					ELSE 'interrupted'::donation_alert_playback_status
				END,
				finished_at = CASE
					WHEN playback.started_at IS NULL AND playback.expires_at > $5 THEN NULL
					ELSE coalesce(playback.finished_at, $5)
				END,
				player_id = CASE WHEN playback.started_at IS NULL THEN NULL ELSE playback.player_id END,
				player_generation = CASE WHEN playback.started_at IS NULL THEN NULL ELSE playback.player_generation END,
				last_error = CASE
					WHEN playback.started_at IS NULL AND playback.expires_at > $5 THEN NULL
					WHEN playback.started_at IS NULL THEN $7
					WHEN playback.status = 'interrupted' THEN playback.last_error
					ELSE coalesce(playback.last_error, $6)
				END
			FROM donation_alert_player AS player
			JOIN donation_alert_overlay AS overlay USING (user_id)
			WHERE overlay.token_hash = $1
				AND player.player_id = $2
				AND player.generation = $3
				AND player.lease_expires_at > $5
				AND playback.donation_alert_playback_id = $4
				AND playback.user_id = player.user_id
				AND playback.player_id = player.player_id
				AND playback.player_generation = player.generation
				AND playback.status IN ('playing', 'interrupted')
		`
		arguments = append(arguments, PlaybackIssueDiagnostic, AlertExpiredDiagnostic)
	}
	command, err := store.pool.Exec(ctx, statement, arguments...)
	if err != nil {
		return err
	}
	if command.RowsAffected() != 1 {
		return ErrLeaseLost
	}
	return nil
}

func (store *Store) RecordPlaybackDiagnostic(
	ctx context.Context,
	tokenHash, playerID string,
	generation int64,
	playbackID string,
	code DiagnosticCode,
	now time.Time,
) error {
	if !validRendererDiagnostic(code) {
		return errors.New("invalid renderer diagnostic")
	}
	command, err := store.pool.Exec(ctx, `
		WITH authorized AS (
			SELECT playback.donation_alert_playback_id, playback.user_id
			FROM donation_alert_playback AS playback
			JOIN donation_alert_player AS player USING (user_id)
			JOIN donation_alert_overlay AS overlay USING (user_id)
			WHERE overlay.token_hash = $1
				AND player.player_id = $2
				AND player.generation = $3
				AND player.lease_expires_at > $5
				AND playback.donation_alert_playback_id = $4
				AND playback.player_id = player.player_id
				AND playback.player_generation = player.generation
				AND playback.started_at IS NOT NULL
				AND playback.status IN ('playing', 'completed', 'interrupted')
		)
		INSERT INTO donation_alert_renderer_diagnostic (
			donation_alert_playback_id, user_id, code, occurred_at
		)
		SELECT donation_alert_playback_id, user_id, $6, $5
		FROM authorized
		ON CONFLICT (donation_alert_playback_id, code) DO UPDATE
		SET occurred_at = least(
			donation_alert_renderer_diagnostic.occurred_at,
			EXCLUDED.occurred_at
		)
	`, tokenHash, playerID, generation, playbackID, now, code)
	if err != nil {
		return err
	}
	if command.RowsAffected() != 1 {
		return ErrLeaseLost
	}
	return nil
}

func (store *Store) PlaybackStatus(ctx context.Context, playbackID string) (PlaybackStatus, error) {
	var status PlaybackStatus
	err := store.pool.QueryRow(ctx, `
		SELECT status::text
		FROM donation_alert_playback
		WHERE donation_alert_playback_id = $1
	`, playbackID).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return status, err
}
