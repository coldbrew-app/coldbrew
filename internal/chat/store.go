package chat

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct {
	pool        *pgxpool.Pool
	tokenCipher *TokenCipher
}

type SaveConnection struct {
	Provider             string
	ProviderUserID       string
	DisplayName          string
	AccessToken          string
	RefreshToken         string
	AccessTokenExpiresAt *time.Time
	Scopes               []string
}

type SaveSource struct {
	Provider         string
	ProviderSourceID string
	DisplayName      string
	SourceURL        string
}

type OauthAttempt struct {
	UserID    int
	Provider  string
	Verifier  string
	ReturnURL string
}

type OwnedConnectedSource struct {
	UserID          int
	ConnectedSource ConnectedSource
}

func NewStore(pool *pgxpool.Pool, tokenCipher *TokenCipher) *Store {
	return &Store{pool: pool, tokenCipher: tokenCipher}
}

func CapabilitiesFor(provider string, scopes []string) []Capability {
	granted := make(map[string]bool, len(scopes))
	for _, scope := range scopes {
		granted[scope] = true
	}
	if provider == "boosty" || provider == "vk_video" {
		return []Capability{CapabilityRead}
	}
	if provider == "youtube" {
		if granted["https://www.googleapis.com/auth/youtube.force-ssl"] {
			return []Capability{CapabilityRead, CapabilitySendMessage, CapabilityDeleteMessage, CapabilityTimeoutUser, CapabilityBanUser, CapabilityUnbanUser}
		}
		return []Capability{CapabilityRead}
	}
	capabilities := make([]Capability, 0, 6)
	if provider == "twitch" {
		if granted["user:read:chat"] {
			capabilities = append(capabilities, CapabilityRead)
		}
		if granted["user:write:chat"] {
			capabilities = append(capabilities, CapabilitySendMessage)
		}
		if granted["moderator:manage:chat_messages"] {
			capabilities = append(capabilities, CapabilityDeleteMessage)
		}
		if granted["moderator:manage:banned_users"] {
			capabilities = append(capabilities, CapabilityTimeoutUser, CapabilityBanUser, CapabilityUnbanUser)
		}
		return capabilities
	}
	if granted["events:subscribe"] {
		capabilities = append(capabilities, CapabilityRead)
	}
	if granted["chat:write"] {
		capabilities = append(capabilities, CapabilitySendMessage)
	}
	if granted["moderation:chat_message:manage"] {
		capabilities = append(capabilities, CapabilityDeleteMessage)
	}
	if granted["moderation:ban"] {
		capabilities = append(capabilities, CapabilityTimeoutUser, CapabilityBanUser, CapabilityUnbanUser)
	}
	return capabilities
}

func (store *Store) GetConfig(ctx context.Context, userID int) (Config, error) {
	connectionRows, err := store.pool.Query(ctx, `
		SELECT chat_provider_connection_id::text, provider::text, provider_user_id, display_name, status::text, scopes, connected_at
		FROM chat_provider_connection
		WHERE user_id = $1
		ORDER BY connected_at, chat_provider_connection_id
	`, userID)
	if err != nil {
		return Config{}, err
	}
	connections := make([]Connection, 0)
	for connectionRows.Next() {
		var connection Connection
		var scopes []string
		if err := connectionRows.Scan(&connection.ConnectionID, &connection.Provider, &connection.ProviderUserID, &connection.DisplayName, &connection.Status, &scopes, &connection.ConnectedAt); err != nil {
			connectionRows.Close()
			return Config{}, err
		}
		connection.Capabilities = CapabilitiesFor(connection.Provider, scopes)
		connections = append(connections, connection)
	}
	if err := connectionRows.Err(); err != nil {
		connectionRows.Close()
		return Config{}, err
	}
	connectionRows.Close()

	sourceRows, err := store.pool.Query(ctx, `
		SELECT chat_source_id::text, chat_provider_connection_id::text, provider::text, provider_source_id, display_name, source_url, position, enabled
		FROM chat_source
		WHERE user_id = $1
		ORDER BY position
	`, userID)
	if err != nil {
		return Config{}, err
	}
	sources := make([]Source, 0)
	for sourceRows.Next() {
		var source Source
		if err := sourceRows.Scan(&source.SourceID, &source.ConnectionID, &source.Provider, &source.ProviderSourceID, &source.DisplayName, &source.SourceURL, &source.Position, &source.Enabled); err != nil {
			sourceRows.Close()
			return Config{}, err
		}
		sources = append(sources, source)
	}
	if err := sourceRows.Err(); err != nil {
		sourceRows.Close()
		return Config{}, err
	}
	sourceRows.Close()

	var hasOverlayToken bool
	err = store.pool.QueryRow(ctx, `SELECT token_hash IS NOT NULL FROM chat_overlay WHERE user_id = $1`, userID).Scan(&hasOverlayToken)
	if errors.Is(err, pgx.ErrNoRows) {
		hasOverlayToken = false
	} else if err != nil {
		return Config{}, err
	}
	return Config{Connections: connections, Sources: sources, HasOverlayToken: hasOverlayToken}, nil
}

func (store *Store) GetEnabledSources(ctx context.Context, userID int) ([]ConnectedSource, error) {
	return store.loadConnectedSources(ctx, userID, "")
}

func (store *Store) GetSource(ctx context.Context, userID int, sourceID string) (*ConnectedSource, error) {
	sources, err := store.loadConnectedSources(ctx, userID, sourceID)
	if err != nil || len(sources) == 0 {
		return nil, err
	}
	return &sources[0], nil
}

func (store *Store) loadConnectedSources(ctx context.Context, userID int, sourceID string) ([]ConnectedSource, error) {
	rows, err := store.pool.Query(ctx, `
		SELECT
			source.chat_source_id::text,
			source.chat_provider_connection_id::text,
			source.provider::text,
			source.provider_source_id,
			source.display_name,
			source.source_url,
			source.position,
			source.enabled,
			connection.access_token_ciphertext,
			connection.refresh_token_ciphertext,
			connection.access_token_expires_at,
			connection.scopes,
			connection.token_version
		FROM chat_source AS source
		JOIN chat_provider_connection AS connection
			ON connection.chat_provider_connection_id = source.chat_provider_connection_id
			AND connection.user_id = source.user_id
		WHERE source.user_id = $1
			AND source.enabled
			AND connection.status = 'connected'
			AND ($2 = '' OR source.chat_source_id = $2::uuid)
		ORDER BY source.position
	`, userID, sourceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]ConnectedSource, 0)
	for rows.Next() {
		connectedSource, err := store.scanConnectedSource(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, connectedSource)
	}
	return result, rows.Err()
}

type rowScanner interface{ Scan(...any) error }

func (store *Store) scanConnectedSource(row rowScanner) (ConnectedSource, error) {
	var result ConnectedSource
	var accessCiphertext, refreshCiphertext []byte
	var expiresAt *time.Time
	var scopes []string
	if err := row.Scan(&result.Source.SourceID, &result.Source.ConnectionID, &result.Source.Provider, &result.Source.ProviderSourceID, &result.Source.DisplayName, &result.Source.SourceURL, &result.Source.Position, &result.Source.Enabled, &accessCiphertext, &refreshCiphertext, &expiresAt, &scopes, &result.Credentials.TokenVersion); err != nil {
		return ConnectedSource{}, err
	}
	if accessCiphertext != nil {
		accessToken, err := store.tokenCipher.Decrypt(accessCiphertext)
		if err != nil {
			return ConnectedSource{}, err
		}
		result.Credentials.AccessToken = accessToken
	}
	if refreshCiphertext != nil {
		refreshToken, err := store.tokenCipher.Decrypt(refreshCiphertext)
		if err != nil {
			return ConnectedSource{}, err
		}
		result.Credentials.RefreshToken = refreshToken
	}
	result.Credentials.ExpiresAt = expiresAt
	result.Credentials.Scopes = scopes
	result.Capabilities = CapabilitiesFor(result.Source.Provider, scopes)
	return result, nil
}

func (store *Store) GetAllEnabledSources(ctx context.Context) ([]OwnedConnectedSource, error) {
	rows, err := store.pool.Query(ctx, `
		SELECT
			source.user_id,
			source.chat_source_id::text,
			source.chat_provider_connection_id::text,
			source.provider::text,
			source.provider_source_id,
			source.display_name,
			source.source_url,
			source.position,
			source.enabled,
			connection.access_token_ciphertext,
			connection.refresh_token_ciphertext,
			connection.access_token_expires_at,
			connection.scopes,
			connection.token_version
		FROM chat_source AS source
		JOIN chat_provider_connection AS connection
			ON connection.chat_provider_connection_id = source.chat_provider_connection_id
			AND connection.user_id = source.user_id
		WHERE source.enabled AND connection.status = 'connected'
		ORDER BY source.user_id, source.position
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]OwnedConnectedSource, 0)
	for rows.Next() {
		var userID int
		wrapped := &prefixedScanner{scanner: rows, prefix: []any{&userID}}
		connectedSource, err := store.scanConnectedSource(wrapped)
		if err != nil {
			return nil, err
		}
		result = append(result, OwnedConnectedSource{UserID: userID, ConnectedSource: connectedSource})
	}
	return result, rows.Err()
}

type prefixedScanner struct {
	scanner rowScanner
	prefix  []any
}

func (scanner *prefixedScanner) Scan(destinations ...any) error {
	return scanner.scanner.Scan(append(scanner.prefix, destinations...)...)
}

func (store *Store) GetEnabledSourceByProviderID(ctx context.Context, provider, providerSourceID string) (*OwnedConnectedSource, error) {
	row := store.pool.QueryRow(ctx, `
		SELECT
			source.user_id,
			source.chat_source_id::text,
			source.chat_provider_connection_id::text,
			source.provider::text,
			source.provider_source_id,
			source.display_name,
			source.source_url,
			source.position,
			source.enabled,
			connection.access_token_ciphertext,
			connection.refresh_token_ciphertext,
			connection.access_token_expires_at,
			connection.scopes,
			connection.token_version
		FROM chat_source AS source
		JOIN chat_provider_connection AS connection
			ON connection.chat_provider_connection_id = source.chat_provider_connection_id
			AND connection.user_id = source.user_id
		WHERE source.provider = $1 AND source.provider_source_id = $2
			AND source.enabled AND connection.status = 'connected'
		LIMIT 1
	`, provider, providerSourceID)
	var userID int
	connectedSource, err := store.scanConnectedSource(&prefixedScanner{scanner: row, prefix: []any{&userID}})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &OwnedConnectedSource{UserID: userID, ConnectedSource: connectedSource}, nil
}

func (store *Store) HasSourceCapacity(ctx context.Context, userID int, provider, providerSourceID string) (bool, error) {
	var capacity bool
	err := store.pool.QueryRow(ctx, `
		SELECT
			EXISTS (
				SELECT 1 FROM chat_source
				WHERE user_id = $1 AND provider = $2 AND provider_source_id = $3
			) OR count(*) < $4
		FROM chat_source
		WHERE user_id = $1
	`, userID, provider, providerSourceID, MaxSources).Scan(&capacity)
	return capacity, err
}

func (store *Store) SaveProviderAccount(ctx context.Context, userID int, connection SaveConnection, source SaveSource) (string, error) {
	var connectionID string
	err := pgx.BeginFunc(ctx, store.pool, func(tx pgx.Tx) error {
		var err error
		connectionID, err = store.saveConnection(ctx, tx, userID, connection)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO chat_source (
				chat_provider_connection_id, user_id, provider, provider_source_id, display_name, source_url, position
			)
			VALUES ($1, $2, $3, $4, $5, $6, (SELECT COALESCE(max(position) + 1, 0) FROM chat_source WHERE user_id = $2))
			ON CONFLICT (user_id, provider, provider_source_id) DO UPDATE
			SET
				chat_provider_connection_id = EXCLUDED.chat_provider_connection_id,
				display_name = EXCLUDED.display_name,
				source_url = EXCLUDED.source_url,
				enabled = true,
				updated_at = now()
		`, connectionID, userID, source.Provider, source.ProviderSourceID, source.DisplayName, source.SourceURL)
		return err
	})
	return connectionID, err
}

func (store *Store) saveConnection(ctx context.Context, tx pgx.Tx, userID int, connection SaveConnection) (string, error) {
	accessCiphertext, err := optionalEncryption(store.tokenCipher, connection.AccessToken)
	if err != nil {
		return "", err
	}
	refreshCiphertext, err := optionalEncryption(store.tokenCipher, connection.RefreshToken)
	if err != nil {
		return "", err
	}
	var connectionID string
	err = tx.QueryRow(ctx, `
		INSERT INTO chat_provider_connection (
			user_id, provider, provider_user_id, display_name, access_token_ciphertext,
			refresh_token_ciphertext, access_token_expires_at, scopes
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (provider, provider_user_id) DO UPDATE
		SET
			display_name = EXCLUDED.display_name,
			access_token_ciphertext = EXCLUDED.access_token_ciphertext,
			refresh_token_ciphertext = COALESCE(EXCLUDED.refresh_token_ciphertext, chat_provider_connection.refresh_token_ciphertext),
			access_token_expires_at = EXCLUDED.access_token_expires_at,
			scopes = EXCLUDED.scopes,
			status = 'connected',
			token_version = chat_provider_connection.token_version + 1,
			updated_at = now()
		WHERE chat_provider_connection.user_id = EXCLUDED.user_id
		RETURNING chat_provider_connection_id::text
	`, userID, connection.Provider, connection.ProviderUserID, connection.DisplayName, accessCiphertext, refreshCiphertext, connection.AccessTokenExpiresAt, connection.Scopes).Scan(&connectionID)
	return connectionID, err
}

func (store *Store) UpdateConnectionCredentials(ctx context.Context, connectionID string, expectedVersion int, accessToken, refreshToken string, expiresAt *time.Time) (*int, error) {
	accessCiphertext, err := store.tokenCipher.Encrypt(accessToken)
	if err != nil {
		return nil, err
	}
	refreshCiphertext, err := optionalEncryption(store.tokenCipher, refreshToken)
	if err != nil {
		return nil, err
	}
	var tokenVersion int
	err = store.pool.QueryRow(ctx, `
		UPDATE chat_provider_connection
		SET
			access_token_ciphertext = $1,
			refresh_token_ciphertext = COALESCE($2, refresh_token_ciphertext),
			access_token_expires_at = $3,
			token_version = token_version + 1,
			status = 'connected',
			updated_at = now()
		WHERE chat_provider_connection_id = $4 AND token_version = $5
		RETURNING token_version
	`, accessCiphertext, refreshCiphertext, expiresAt, connectionID, expectedVersion).Scan(&tokenVersion)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &tokenVersion, err
}

func (store *Store) CreateOauthAttempt(ctx context.Context, stateHash string, userID int, provider, verifier, returnURL string, expiresAt time.Time) error {
	verifierCiphertext, err := store.tokenCipher.Encrypt(verifier)
	if err != nil {
		return err
	}
	return pgx.BeginFunc(ctx, store.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM chat_oauth_attempt WHERE expires_at <= now()`); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO chat_oauth_attempt (state_hash, user_id, provider, pkce_verifier_ciphertext, return_url, expires_at)
			VALUES ($1, $2, $3, $4, $5, $6)
		`, stateHash, userID, provider, verifierCiphertext, returnURL, expiresAt)
		return err
	})
}

func (store *Store) ConsumeOauthAttempt(ctx context.Context, stateHash, provider string) (*OauthAttempt, error) {
	var attempt OauthAttempt
	var verifierCiphertext []byte
	err := store.pool.QueryRow(ctx, `
		DELETE FROM chat_oauth_attempt
		WHERE state_hash = $1 AND provider = $2 AND expires_at > now()
		RETURNING user_id, provider::text, pkce_verifier_ciphertext, return_url
	`, stateHash, provider).Scan(&attempt.UserID, &attempt.Provider, &verifierCiphertext, &attempt.ReturnURL)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	attempt.Verifier, err = store.tokenCipher.Decrypt(verifierCiphertext)
	return &attempt, err
}

func (store *Store) Disconnect(ctx context.Context, userID int, connectionID string) error {
	_, err := store.pool.Exec(ctx, `DELETE FROM chat_provider_connection WHERE user_id = $1 AND chat_provider_connection_id = $2`, userID, connectionID)
	return err
}

func (store *Store) GetProviderBanID(ctx context.Context, sourceID, providerUserID string) (string, error) {
	var providerBanID string
	err := store.pool.QueryRow(ctx, `SELECT provider_ban_id FROM chat_provider_ban WHERE chat_source_id = $1 AND provider_user_id = $2`, sourceID, providerUserID).Scan(&providerBanID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return providerBanID, err
}

func (store *Store) SaveProviderBanID(ctx context.Context, sourceID, providerUserID, providerBanID string) error {
	_, err := store.pool.Exec(ctx, `
		INSERT INTO chat_provider_ban (chat_source_id, provider_user_id, provider_ban_id)
		VALUES ($1, $2, $3)
		ON CONFLICT (chat_source_id, provider_user_id) DO UPDATE
		SET provider_ban_id = EXCLUDED.provider_ban_id, updated_at = now()
	`, sourceID, providerUserID, providerBanID)
	return err
}

func (store *Store) DeleteProviderBanID(ctx context.Context, sourceID, providerUserID string) error {
	_, err := store.pool.Exec(ctx, `DELETE FROM chat_provider_ban WHERE chat_source_id = $1 AND provider_user_id = $2`, sourceID, providerUserID)
	return err
}

func (store *Store) RecordAction(ctx context.Context, entry AuditEntry) error {
	_, err := store.pool.Exec(ctx, `
		INSERT INTO chat_moderation_action (
			user_id, chat_source_id, provider, action_type, status, provider_message_id,
			provider_user_id, duration_seconds, reason, detail
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
	`, entry.UserID, entry.SourceID, entry.Provider, entry.ActionType, entry.Status, nullableString(entry.ProviderMessageID), nullableString(entry.ProviderUserID), nullablePositive(entry.DurationSeconds), nullableString(entry.Reason), nullableString(entry.Detail))
	return err
}

func optionalEncryption(tokenCipher *TokenCipher, value string) ([]byte, error) {
	if value == "" {
		return nil, nil
	}
	return tokenCipher.Encrypt(value)
}

func nullableString(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func nullablePositive(value int) any {
	if value == 0 {
		return nil
	}
	return value
}

var _ Repository = (*Store)(nil)

func validateProvider(provider string) error {
	switch provider {
	case "youtube", "twitch", "kick", "boosty", "vk_video":
		return nil
	default:
		return fmt.Errorf("invalid chat provider %q", provider)
	}
}
