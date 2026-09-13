package donationalert

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct{ pool *pgxpool.Pool }

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

func ensureConfiguration(ctx context.Context, tx pgx.Tx, userID int) error {
	if _, err := tx.Exec(ctx, `
		INSERT INTO donation_alert_configuration (user_id)
		VALUES ($1)
		ON CONFLICT (user_id) DO NOTHING
	`, userID); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO donation_alert_source (user_id, source)
		SELECT $1, source
		FROM unnest(enum_range(NULL::donation_source)) AS source
		ON CONFLICT (user_id, source) DO NOTHING
	`, userID)
	return err
}

func (store *Store) EnsureConfiguration(ctx context.Context, userID int) error {
	return pgx.BeginFunc(ctx, store.pool, func(tx pgx.Tx) error {
		return ensureConfiguration(ctx, tx, userID)
	})
}

func lockConfiguration(ctx context.Context, tx pgx.Tx, userID int) error {
	var lockedUserID int
	err := tx.QueryRow(ctx, `
		SELECT user_id
		FROM donation_alert_configuration
		WHERE user_id = $1
		FOR UPDATE
	`, userID).Scan(&lockedUserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

func (store *Store) Settings(ctx context.Context, userID int) (Settings, error) {
	if err := store.EnsureConfiguration(ctx, userID); err != nil {
		return Settings{}, err
	}
	settings := DefaultSettings()
	err := store.pool.QueryRow(ctx, `
		SELECT enabled,
			paused,
			display_duration_ms,
			sound_volume,
			tts_enabled,
			tts_voice,
			tts_volume,
			accent_color::text,
			image_asset_id::text,
			sound_asset_id::text
		FROM donation_alert_configuration
		WHERE user_id = $1
	`, userID).Scan(
		&settings.Enabled,
		&settings.Paused,
		&settings.DisplayDurationMS,
		&settings.SoundVolume,
		&settings.TTSEnabled,
		&settings.TTSVoice,
		&settings.TTSVolume,
		&settings.AccentColor,
		&settings.ImageAssetID,
		&settings.SoundAssetID,
	)
	if err != nil {
		return Settings{}, err
	}
	rows, err := store.pool.Query(ctx, `
		SELECT source::text
		FROM donation_alert_source
		WHERE user_id = $1 AND enabled
		ORDER BY source
	`, userID)
	if err != nil {
		return Settings{}, err
	}
	defer rows.Close()
	settings.EnabledSources = make([]Source, 0, len(allSources))
	for rows.Next() {
		var source Source
		if err := rows.Scan(&source); err != nil {
			return Settings{}, err
		}
		settings.EnabledSources = append(settings.EnabledSources, source)
	}
	if err := rows.Err(); err != nil {
		return Settings{}, err
	}
	return settings, nil
}

func (store *Store) UpdateSettings(ctx context.Context, userID int, settings Settings) (Settings, error) {
	settings.TTSVoice = strings.TrimSpace(settings.TTSVoice)
	if err := settings.Validate(); err != nil {
		return Settings{}, err
	}
	err := pgx.BeginFunc(ctx, store.pool, func(tx pgx.Tx) error {
		if err := ensureConfiguration(ctx, tx, userID); err != nil {
			return err
		}
		if err := lockConfiguration(ctx, tx, userID); err != nil {
			return err
		}
		if err := validateAssetReference(ctx, tx, userID, settings.ImageAssetID, ImageAsset); err != nil {
			return err
		}
		if err := validateAssetReference(ctx, tx, userID, settings.SoundAssetID, SoundAsset); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `
			UPDATE donation_alert_configuration
			SET enabled = $2,
				display_duration_ms = $3,
				sound_volume = $4,
				tts_enabled = $5,
				tts_voice = $6,
				tts_volume = $7,
				accent_color = $8,
				image_asset_id = $9,
				sound_asset_id = $10,
				updated_at = now()
			WHERE user_id = $1
		`, userID, settings.Enabled, settings.DisplayDurationMS, settings.SoundVolume, settings.TTSEnabled, settings.TTSVoice, settings.TTSVolume, settings.AccentColor, settings.ImageAssetID, settings.SoundAssetID)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `
			UPDATE donation_alert_source
			SET enabled = source = ANY ($2::donation_source[])
			WHERE user_id = $1
		`, userID, sourceStrings(settings.EnabledSources))
		return err
	})
	if err != nil {
		return Settings{}, err
	}
	return store.Settings(ctx, userID)
}

func validateAssetReference(ctx context.Context, tx pgx.Tx, userID int, assetID *string, kind AssetKind) error {
	if assetID == nil {
		return nil
	}
	var found bool
	err := tx.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM donation_alert_asset
			WHERE donation_alert_asset_id = $1 AND user_id = $2 AND kind = $3
		)
	`, *assetID, userID, kind).Scan(&found)
	if err != nil {
		return err
	}
	if !found {
		return ErrNotFound
	}
	return nil
}

func sourceStrings(sources []Source) []string {
	result := make([]string, len(sources))
	for index, source := range sources {
		result[index] = string(source)
	}
	return result
}

func (store *Store) SetPaused(ctx context.Context, userID int, paused bool) error {
	return pgx.BeginFunc(ctx, store.pool, func(tx pgx.Tx) error {
		if err := ensureConfiguration(ctx, tx, userID); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `
			UPDATE donation_alert_configuration
			SET paused = $2, updated_at = now()
			WHERE user_id = $1
		`, userID, paused)
		return err
	})
}

func (store *Store) SaveAsset(ctx context.Context, userID int, kind AssetKind, media Media, now time.Time) (Asset, error) {
	hash := sha256.Sum256(media.Content)
	contentHash := hex.EncodeToString(hash[:])
	var asset Asset
	var duration *int
	if media.DurationMS > 0 {
		duration = &media.DurationMS
	}
	err := pgx.BeginFunc(ctx, store.pool, func(tx pgx.Tx) error {
		if err := ensureConfiguration(ctx, tx, userID); err != nil {
			return err
		}
		if err := lockConfiguration(ctx, tx, userID); err != nil {
			return err
		}
		err := tx.QueryRow(ctx, `
			INSERT INTO donation_alert_asset (
				user_id, kind, mime_type, content, content_hash, duration_ms, created_at
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			ON CONFLICT (user_id, kind, content_hash) DO UPDATE
			SET content_hash = EXCLUDED.content_hash
			RETURNING donation_alert_asset_id::text, kind::text, mime_type,
				octet_length(content), duration_ms, created_at
		`, userID, kind, media.MIMEType, media.Content, contentHash, duration, now).Scan(
			&asset.AssetID, &asset.Kind, &asset.ContentType, &asset.SizeBytes, &asset.DurationMS, &asset.CreatedAt,
		)
		if err != nil {
			return err
		}
		column := "image_asset_id"
		if kind == SoundAsset {
			column = "sound_asset_id"
		}
		if kind != ImageAsset && kind != SoundAsset {
			return errors.New("only image and sound assets can be selected")
		}
		_, err = tx.Exec(ctx, fmt.Sprintf(`
			UPDATE donation_alert_configuration
			SET %s = $2, updated_at = now()
			WHERE user_id = $1
		`, pgx.Identifier{column}.Sanitize()), userID, asset.AssetID)
		return err
	})
	return asset, err
}

func (store *Store) AssetMetadata(ctx context.Context, assetID string) (*Asset, error) {
	var asset Asset
	err := store.pool.QueryRow(ctx, `
		SELECT donation_alert_asset_id::text, kind::text, mime_type,
			octet_length(content), duration_ms, created_at
		FROM donation_alert_asset
		WHERE donation_alert_asset_id = $1
	`, assetID).Scan(&asset.AssetID, &asset.Kind, &asset.ContentType, &asset.SizeBytes, &asset.DurationMS, &asset.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &asset, nil
}

func (store *Store) DeleteAsset(ctx context.Context, userID int, assetID string) error {
	err := pgx.BeginFunc(ctx, store.pool, func(tx pgx.Tx) error {
		if err := ensureConfiguration(ctx, tx, userID); err != nil {
			return err
		}
		if err := lockConfiguration(ctx, tx, userID); err != nil {
			return err
		}
		var owned bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1
				FROM donation_alert_asset
				WHERE donation_alert_asset_id = $1 AND user_id = $2 AND kind <> 'tts'
			)
		`, assetID, userID).Scan(&owned); err != nil {
			return err
		}
		if !owned {
			return ErrNotFound
		}
		_, err := tx.Exec(ctx, `
			UPDATE donation_alert_configuration
			SET image_asset_id = CASE WHEN image_asset_id = $2 THEN NULL ELSE image_asset_id END,
				sound_asset_id = CASE WHEN sound_asset_id = $2 THEN NULL ELSE sound_asset_id END,
				updated_at = now()
			WHERE user_id = $1
		`, userID, assetID)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `
			UPDATE donation_alert_playback
			SET image_asset_id = CASE WHEN image_asset_id = $1 THEN NULL ELSE image_asset_id END,
				sound_asset_id = CASE WHEN sound_asset_id = $1 THEN NULL ELSE sound_asset_id END
			WHERE user_id = $2
				AND status IN ('completed', 'skipped', 'expired', 'interrupted')
				AND (image_asset_id = $1 OR sound_asset_id = $1)
		`, assetID, userID)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `
			DELETE FROM donation_alert_asset
			WHERE donation_alert_asset_id = $1
				AND user_id = $2
				AND NOT EXISTS (
					SELECT 1
					FROM donation_alert_playback
					WHERE image_asset_id = $1 OR sound_asset_id = $1 OR tts_asset_id = $1
				)
		`, assetID, userID)
		return err
	})
	return err
}
