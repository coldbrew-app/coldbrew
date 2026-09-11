package donations

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lebedev-nikita/coldbrew/internal/donatestream"
)

type Store struct{ pool *pgxpool.Pool }

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

type providerStore struct {
	pool            *pgxpool.Pool
	source          Source
	connectionTable string
}

func (store *Store) forSource(source Source) *providerStore {
	var table string
	switch source {
	case DonationAlertsSource:
		table = "donationalerts_connection"
	case StreamlabsSource:
		table = "streamlabs_connection"
	default:
		panic("unsupported donation source: " + source)
	}
	return &providerStore{
		pool:            store.pool,
		source:          source,
		connectionTable: pgx.Identifier{table}.Sanitize(),
	}
}

func (store *providerStore) Connections(ctx context.Context) ([]Connection, error) {
	rows, err := store.pool.Query(ctx, fmt.Sprintf(`
		SELECT user_id, source_user_id, access_token, refresh_token, token_version, history_checkpoint
		FROM %s
		ORDER BY user_id
	`, store.connectionTable))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	connections := make([]Connection, 0)
	for rows.Next() {
		var connection Connection
		if err := rows.Scan(&connection.UserID, &connection.SourceUserID, &connection.AccessToken, &connection.RefreshToken, &connection.TokenVersion, &connection.HistoryCheckpoint); err != nil {
			return nil, err
		}
		connections = append(connections, connection)
	}
	return connections, rows.Err()
}

func (store *providerStore) SaveConnectionWithDonations(ctx context.Context, userID int, connection ProviderConnection, batch DonationBatch) error {
	return pgx.BeginFunc(ctx, store.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, fmt.Sprintf(`
			INSERT INTO %s (
				user_id, source_user_id, access_token, refresh_token, history_checkpoint
			)
			VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (user_id) DO UPDATE
			SET
				source_user_id = EXCLUDED.source_user_id,
				access_token = EXCLUDED.access_token,
				refresh_token = EXCLUDED.refresh_token,
				history_checkpoint = EXCLUDED.history_checkpoint,
				token_version = %s.token_version + 1,
				updated_at = now()
		`, store.connectionTable, store.connectionTable), userID, connection.SourceUserID, connection.AccessToken, connection.RefreshToken, batch.Checkpoint); err != nil {
			return err
		}
		return insertDonations(ctx, tx, store.source, userID, batch.Donations)
	})
}

func (store *providerStore) SaveDonations(ctx context.Context, userID, tokenVersion int, batch DonationBatch) error {
	return pgx.BeginFunc(ctx, store.pool, func(tx pgx.Tx) error {
		command, err := tx.Exec(ctx, fmt.Sprintf(`
			UPDATE %s
			SET
				history_checkpoint = coalesce($1, history_checkpoint),
				updated_at = CASE WHEN $1::text IS NULL THEN updated_at ELSE now() END
			WHERE user_id = $2 AND token_version = $3
		`, store.connectionTable), batch.Checkpoint, userID, tokenVersion)
		if err != nil {
			return err
		}
		if command.RowsAffected() != 1 {
			return ErrStaleCredentials
		}
		return insertDonations(ctx, tx, store.source, userID, batch.Donations)
	})
}

func insertDonations(ctx context.Context, tx pgx.Tx, source Source, userID int, donations []Donation) error {
	for _, donation := range donations {
		if _, err := tx.Exec(ctx, `
			INSERT INTO donation (
				source,
				source_donation_id,
				user_id,
				author,
				message,
				amount,
				currency,
				source_created_at,
				occurred_at
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
			ON CONFLICT (user_id, source, source_donation_id) DO NOTHING
		`, source, donation.SourceDonationID, userID, donation.Author, donation.Message, donation.Amount, donation.Currency, donation.SourceCreatedAt, donation.OccurredAt); err != nil {
			return err
		}
	}
	return nil
}

func (store *providerStore) SetTokensIfVersion(ctx context.Context, userID, tokenVersion int, tokens Tokens) (bool, error) {
	command, err := store.pool.Exec(ctx, fmt.Sprintf(`
		UPDATE %s
		SET
			refresh_token = $1,
			access_token = $2,
			token_version = token_version + 1,
			updated_at = now()
		WHERE user_id = $3 AND token_version = $4
	`, store.connectionTable), tokens.RefreshToken, tokens.AccessToken, userID, tokenVersion)
	if err != nil {
		return false, err
	}
	return command.RowsAffected() == 1, nil
}

func (store *providerStore) Disconnect(ctx context.Context, userID int) error {
	_, err := store.pool.Exec(ctx, fmt.Sprintf(`
		DELETE FROM %s
		WHERE user_id = $1
	`, store.connectionTable), userID)
	return err
}

func (store *providerStore) DisconnectIfVersion(ctx context.Context, userID, tokenVersion int) (bool, error) {
	command, err := store.pool.Exec(ctx, fmt.Sprintf(`
		DELETE FROM %s
		WHERE user_id = $1 AND token_version = $2
	`, store.connectionTable), userID, tokenVersion)
	if err != nil {
		return false, err
	}
	return command.RowsAffected() == 1, nil
}

func (store *Store) DonateStreamConnections(ctx context.Context) ([]DonateStreamConnection, error) {
	rows, err := store.pool.Query(ctx, `
		SELECT user_id, widget_group_uid, widget_token
		FROM donate_stream_connection
		ORDER BY user_id
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	connections := make([]DonateStreamConnection, 0)
	for rows.Next() {
		var connection DonateStreamConnection
		if err := rows.Scan(&connection.UserID, &connection.WidgetGroupUID, &connection.WidgetToken); err != nil {
			return nil, err
		}
		connections = append(connections, connection)
	}
	return connections, rows.Err()
}

func (store *Store) SaveDonateStreamConnection(ctx context.Context, userID int, connection donatestream.Connection) error {
	_, err := store.pool.Exec(ctx, `
		INSERT INTO donate_stream_connection (user_id, widget_group_uid, widget_token)
		VALUES ($1, $2, $3)
		ON CONFLICT (user_id) DO UPDATE
		SET
			widget_group_uid = EXCLUDED.widget_group_uid,
			widget_token = EXCLUDED.widget_token,
			updated_at = now()
	`, userID, connection.WidgetGroupUID, connection.WidgetToken)
	return err
}

func (store *Store) InsertDonateStreamDonations(ctx context.Context, userID int, donations []donatestream.Donation) error {
	if len(donations) == 0 {
		return nil
	}
	return pgx.BeginFunc(ctx, store.pool, func(tx pgx.Tx) error {
		return insertDonateStreamDonations(ctx, tx, userID, donations)
	})
}

func insertDonateStreamDonations(ctx context.Context, tx pgx.Tx, userID int, donations []donatestream.Donation) error {
	for _, donation := range donations {
		if _, err := tx.Exec(ctx, `
			INSERT INTO donation (
				source,
				source_donation_id,
				user_id,
				author,
				message,
				amount,
				currency,
				source_created_at,
				occurred_at
			)
			VALUES ('donate_stream', $1, $2, $3, $4, $5, $6, $7, $8)
			ON CONFLICT (user_id, source, source_donation_id) DO NOTHING
		`, donation.SourceDonationID, userID, donation.Author, donation.Message, donation.Amount, donation.Currency, donation.SourceCreatedAt, donation.OccurredAt); err != nil {
			return err
		}
	}
	return nil
}

func (store *Store) DisconnectDonateStream(ctx context.Context, userID int) error {
	_, err := store.pool.Exec(ctx, `
		DELETE FROM donate_stream_connection
		WHERE user_id = $1
	`, userID)
	return err
}

func (store *Store) DisconnectDonateStreamIfToken(ctx context.Context, userID int, widgetToken string) (bool, error) {
	command, err := store.pool.Exec(ctx, `
		DELETE FROM donate_stream_connection
		WHERE user_id = $1 AND widget_token = $2
	`, userID, widgetToken)
	return command.RowsAffected() == 1, err
}

var _ persistence = (*providerStore)(nil)
var _ donateStreamPersistence = (*Store)(nil)
