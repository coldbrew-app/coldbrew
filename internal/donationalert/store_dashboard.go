package donationalert

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func (store *Store) SetOverlayTokenHash(ctx context.Context, userID int, tokenHash string, now time.Time) error {
	return pgx.BeginFunc(ctx, store.pool, func(tx pgx.Tx) error {
		if err := ensureConfiguration(ctx, tx, userID); err != nil {
			return err
		}
		if _, err := lockAlertQueue(ctx, tx, userID); err != nil {
			return err
		}
		var lockedUserID int
		err := tx.QueryRow(ctx, `
			SELECT user_id
			FROM donation_alert_overlay
			WHERE user_id = $1
			FOR UPDATE
		`, userID).Scan(&lockedUserID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		var lockedPlayerID string
		err = tx.QueryRow(ctx, `
			SELECT player_id::text
			FROM donation_alert_player
			WHERE user_id = $1
			FOR UPDATE
		`, userID).Scan(&lockedPlayerID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if recoverErr := recoverUserPlayback(ctx, tx, userID, now, OverlayRotatedDiagnostic); recoverErr != nil {
			return recoverErr
		}
		if _, execErr := tx.Exec(ctx, `
			DELETE FROM donation_alert_player
			WHERE user_id = $1
		`, userID); execErr != nil {
			return execErr
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO donation_alert_overlay (user_id, token_hash, updated_at)
			VALUES ($1, $2, $3)
			ON CONFLICT (user_id) DO UPDATE
			SET token_hash = EXCLUDED.token_hash, updated_at = EXCLUDED.updated_at
		`, userID, tokenHash, now)
		return err
	})
}

func (store *Store) UserIDByTokenHash(ctx context.Context, tokenHash string) (int, error) {
	var userID int
	err := store.pool.QueryRow(ctx, `
		SELECT user_id
		FROM donation_alert_overlay
		WHERE token_hash = $1
	`, tokenHash).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrInvalidToken
	}
	return userID, err
}

func (store *Store) AssetForUser(ctx context.Context, userID int, assetID string) (*Asset, error) {
	return store.assetForUser(ctx, userID, assetID, false)
}

func (store *Store) PlayerAssetForUser(ctx context.Context, userID int, assetID string) (*Asset, error) {
	return store.assetForUser(ctx, userID, assetID, true)
}

func (store *Store) assetForUser(ctx context.Context, userID int, assetID string, requirePlayingReference bool) (*Asset, error) {
	var asset Asset
	err := store.pool.QueryRow(ctx, `
		SELECT donation_alert_asset_id::text, kind::text, mime_type,
			octet_length(content), duration_ms, created_at, content
		FROM donation_alert_asset
		WHERE donation_alert_asset_id = $1
			AND user_id = $2
			AND (
				NOT $3 OR EXISTS (
					SELECT 1
					FROM donation_alert_playback
					WHERE user_id = $2
						AND status = 'playing'
						AND (
							image_asset_id = $1 OR
							sound_asset_id = $1 OR
							tts_asset_id = $1
						)
				)
			)
	`, assetID, userID, requirePlayingReference).Scan(
		&asset.AssetID,
		&asset.Kind,
		&asset.ContentType,
		&asset.SizeBytes,
		&asset.DurationMS,
		&asset.CreatedAt,
		&asset.Content,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &asset, nil
}

func (store *Store) StreamState(ctx context.Context, tokenHash, playerID string, generation int64, now time.Time) (bool, *Playback, error) {
	var paused bool
	var playback *Playback
	leaseLost := false
	err := pgx.BeginFunc(ctx, store.pool, func(tx pgx.Tx) error {
		var userID int
		var leaseExpires time.Time
		err := tx.QueryRow(ctx, `
			SELECT player.user_id, configuration.paused, player.lease_expires_at
			FROM donation_alert_player AS player
			JOIN donation_alert_overlay AS overlay USING (user_id)
			JOIN donation_alert_configuration AS configuration USING (user_id)
			WHERE overlay.token_hash = $1
				AND player.player_id = $2
				AND player.generation = $3
			FOR UPDATE OF player
		`, tokenHash, playerID, generation).Scan(&userID, &paused, &leaseExpires)
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
		playback, err = scanPlayback(tx.QueryRow(ctx, playbackSelect+`
			WHERE user_id = $3
				AND player_id = $1
				AND player_generation = $2
				AND status = 'playing'
			ORDER BY queue_sequence
			LIMIT 1
		`, playerID, generation, userID))
		if errors.Is(err, pgx.ErrNoRows) {
			playback = nil
			return nil
		}
		return err
	})
	if err != nil {
		return false, nil, err
	}
	if leaseLost {
		return false, nil, ErrLeaseLost
	}
	return paused, playback, nil
}

func (store *Store) Dashboard(ctx context.Context, userID int, now time.Time) (Dashboard, error) {
	settings, err := store.Settings(ctx, userID)
	if err != nil {
		return Dashboard{}, err
	}
	dashboard := Dashboard{
		Settings:         settings,
		ConnectedSources: make([]Source, 0, len(allSources)),
		RecentPlaybacks:  make([]Playback, 0),
		Diagnostics:      make([]Diagnostic, 0),
	}
	if settings.ImageAssetID != nil {
		dashboard.ImageAsset, err = store.AssetMetadata(ctx, *settings.ImageAssetID)
		if err != nil {
			return Dashboard{}, err
		}
	}
	if settings.SoundAssetID != nil {
		dashboard.SoundAsset, err = store.AssetMetadata(ctx, *settings.SoundAssetID)
		if err != nil {
			return Dashboard{}, err
		}
	}
	if queryErr := store.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM donation_alert_overlay
			WHERE user_id = $1 AND token_hash IS NOT NULL
		)
	`, userID).Scan(&dashboard.HasOverlayToken); queryErr != nil {
		return Dashboard{}, queryErr
	}

	rows, err := store.pool.Query(ctx, `
		SELECT source
		FROM (
			SELECT 'donationalerts'::text AS source
			WHERE EXISTS (SELECT 1 FROM donationalerts_connection WHERE user_id = $1)
			UNION ALL
			SELECT 'donate_stream'::text
			WHERE EXISTS (SELECT 1 FROM donate_stream_connection WHERE user_id = $1)
			UNION ALL
			SELECT 'streamlabs'::text
			WHERE EXISTS (SELECT 1 FROM streamlabs_connection WHERE user_id = $1)
		) AS connected
		ORDER BY source
	`, userID)
	if err != nil {
		return Dashboard{}, err
	}
	for rows.Next() {
		var source Source
		if scanErr := rows.Scan(&source); scanErr != nil {
			rows.Close()
			return Dashboard{}, scanErr
		}
		dashboard.ConnectedSources = append(dashboard.ConnectedSources, source)
	}
	if rowsErr := rows.Err(); rowsErr != nil {
		rows.Close()
		return Dashboard{}, rowsErr
	}
	rows.Close()

	if queryErr := store.pool.QueryRow(ctx, `
		SELECT count(*)
		FROM donation_alert_playback
		WHERE user_id = $1
			AND status IN ('preparing', 'pending')
			AND expires_at > $2
	`, userID, now).Scan(&dashboard.PendingCount); queryErr != nil {
		return Dashboard{}, queryErr
	}

	player, err := store.dashboardPlayer(ctx, userID, now)
	if err != nil {
		return Dashboard{}, err
	}
	dashboard.ActivePlayer = player

	current, err := store.currentPlaybackForUser(ctx, userID)
	if err != nil {
		return Dashboard{}, err
	}
	dashboard.CurrentPlayback = current

	rows, err = store.pool.Query(ctx, playbackSelect+`
		WHERE user_id = $1
		ORDER BY queue_sequence DESC
		LIMIT 20
	`, userID)
	if err != nil {
		return Dashboard{}, err
	}
	for rows.Next() {
		playback, scanErr := scanPlayback(rows)
		if scanErr != nil {
			rows.Close()
			return Dashboard{}, scanErr
		}
		dashboard.RecentPlaybacks = append(dashboard.RecentPlaybacks, *playback)
	}
	if rowsErr := rows.Err(); rowsErr != nil {
		rows.Close()
		return Dashboard{}, rowsErr
	}
	rows.Close()

	rows, err = store.pool.Query(ctx, `
		SELECT detail, occurred_at
		FROM (
			SELECT last_error AS detail,
				coalesce(finished_at, started_at, created_at) AS occurred_at
			FROM donation_alert_playback
			WHERE user_id = $1 AND last_error IS NOT NULL
			UNION ALL
			SELECT code AS detail, occurred_at
			FROM donation_alert_renderer_diagnostic
			WHERE user_id = $1
		) AS diagnostic
		ORDER BY occurred_at DESC, detail
		LIMIT 20
	`, userID)
	if err != nil {
		return Dashboard{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var detail string
		var occurredAt time.Time
		if scanErr := rows.Scan(&detail, &occurredAt); scanErr != nil {
			return Dashboard{}, scanErr
		}
		code := diagnosticCode(detail)
		dashboard.Diagnostics = append(dashboard.Diagnostics, Diagnostic{
			Code:       code,
			Level:      diagnosticLevel(code),
			Detail:     diagnosticDescription(code),
			OccurredAt: occurredAt,
		})
	}
	return dashboard, rows.Err()
}

func (store *Store) dashboardPlayer(ctx context.Context, userID int, now time.Time) (*Player, error) {
	var player Player
	player.State = "active"
	err := store.pool.QueryRow(ctx, `
		SELECT player.player_id::text,
			player.generation,
			player.active,
			player.visible,
			player.last_seen_at,
			player.lease_expires_at,
			playback.donation_alert_playback_id::text
		FROM donation_alert_player AS player
		LEFT JOIN donation_alert_playback AS playback
			ON playback.user_id = player.user_id
			AND playback.player_id = player.player_id
			AND playback.player_generation = player.generation
			AND playback.status = 'playing'
		WHERE player.user_id = $1 AND player.lease_expires_at > $2
	`, userID, now).Scan(
		&player.PlayerID,
		&player.Generation,
		&player.Active,
		&player.Visible,
		&player.LastHeartbeatAt,
		&player.LeaseExpiresAt,
		&player.CurrentPlaybackID,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil //nolint:nilnil // No active player is a valid dashboard state.
	}
	if err != nil {
		return nil, err
	}
	return &player, nil
}

func (store *Store) currentPlaybackForUser(ctx context.Context, userID int) (*Playback, error) {
	playback, err := scanPlayback(store.pool.QueryRow(ctx, playbackSelect+`
		WHERE user_id = $1 AND status = 'playing'
		ORDER BY queue_sequence
		LIMIT 1
	`, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil //nolint:nilnil // No current playback is a valid dashboard state.
	}
	return playback, err
}

const playbackSelect = `
	SELECT donation_alert_playback_id::text,
		donation_id,
		kind::text,
		status::text,
		source::text,
		author,
		message,
		amount::text,
		currency::text,
		image_asset_id::text,
		sound_asset_id::text,
		tts_asset_id::text,
		display_duration_ms,
		sound_volume,
		tts_volume,
		accent_color::text,
		created_at,
		started_at,
		finished_at,
		last_error
	FROM donation_alert_playback
`

type rowScanner interface{ Scan(...any) error }

func scanPlayback(row rowScanner) (*Playback, error) {
	var playback Playback
	var rawSource *string
	err := row.Scan(
		&playback.PlaybackID,
		&playback.DonationID,
		&playback.Kind,
		&playback.State,
		&rawSource,
		&playback.Author,
		&playback.Message,
		&playback.Amount,
		&playback.Currency,
		&playback.ImageAssetID,
		&playback.SoundAssetID,
		&playback.TTSAssetID,
		&playback.DisplayDurationMS,
		&playback.SoundVolume,
		&playback.TTSVolume,
		&playback.AccentColor,
		&playback.CreatedAt,
		&playback.StartedAt,
		&playback.FinishedAt,
		&playback.Detail,
	)
	if err != nil {
		return nil, err
	}
	if rawSource != nil {
		source := Source(*rawSource)
		playback.Source = &source
	}
	return &playback, nil
}

func diagnosticForPlayback(playback Playback) *Diagnostic {
	if playback.Detail == nil {
		return nil
	}
	code := diagnosticCode(*playback.Detail)
	occurredAt := playback.CreatedAt
	if playback.StartedAt != nil {
		occurredAt = *playback.StartedAt
	}
	if playback.FinishedAt != nil {
		occurredAt = *playback.FinishedAt
	}
	return &Diagnostic{
		Code:       code,
		Level:      diagnosticLevel(code),
		Detail:     diagnosticDescription(code),
		OccurredAt: occurredAt,
	}
}

func diagnosticLevel(code DiagnosticCode) DiagnosticLevel {
	level := DiagnosticWarning
	if code == PlaybackTimeoutDiagnostic || code == OverlayRotatedDiagnostic {
		level = DiagnosticError
	}
	return level
}

func diagnosticCode(detail string) DiagnosticCode {
	code := DiagnosticCode(detail)
	switch code {
	case ImageUnavailableDiagnostic,
		SoundUnavailableDiagnostic,
		TTSUnavailableDiagnostic,
		AudioBlockedDiagnostic,
		AlertExpiredDiagnostic,
		BacklogLimitDiagnostic,
		PlaybackTimeoutDiagnostic,
		PlayerDisconnectedDiagnostic,
		OverlayRotatedDiagnostic,
		PlaybackIssueDiagnostic:
		return code
	}
	if strings.HasPrefix(detail, "Speech ") || strings.HasPrefix(detail, "Donation message ") {
		return TTSUnavailableDiagnostic
	}
	return PlaybackIssueDiagnostic
}

func diagnosticDescription(code DiagnosticCode) string {
	switch code {
	case ImageUnavailableDiagnostic:
		return "The alert image could not be displayed."
	case SoundUnavailableDiagnostic:
		return "The alert sound could not be played."
	case TTSUnavailableDiagnostic:
		return "Donation speech could not be played."
	case AudioBlockedDiagnostic:
		return "The browser blocked alert audio playback."
	case AlertExpiredDiagnostic:
		return "The alert expired before playback completed."
	case BacklogLimitDiagnostic:
		return "The alert expired because the queue reached its limit."
	case PlaybackTimeoutDiagnostic:
		return "The player did not acknowledge completion before the recovery deadline."
	case PlayerDisconnectedDiagnostic:
		return "The active alert player disconnected during playback."
	case OverlayRotatedDiagnostic:
		return "Playback stopped because the OBS link was rotated."
	case PlaybackIssueDiagnostic:
		return "The alert did not complete normally."
	default:
		return "The alert did not complete normally."
	}
}
