package donations

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lebedev-nikita/coldbrew/internal/donationalerts"
)

type Store struct{ pool *pgxpool.Pool }

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

func (store *Store) Connections(ctx context.Context) ([]Connection, error) {
	rows, err := store.pool.Query(ctx, `
		SELECT user_id, source_user_id, access_token, refresh_token, token_version, history_checkpoint
		FROM donationalerts_connection
		ORDER BY user_id
	`)
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

func (store *Store) InsertDonations(ctx context.Context, userID int, donations []donationalerts.Donation) error {
	if len(donations) == 0 {
		return nil
	}
	return pgx.BeginFunc(ctx, store.pool, func(tx pgx.Tx) error {
		return insertDonations(ctx, tx, userID, donations)
	})
}

func (store *Store) SaveConnectionWithDonations(ctx context.Context, userID int, connection donationalerts.Connection, donations []donationalerts.Donation) error {
	return pgx.BeginFunc(ctx, store.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
			INSERT INTO donationalerts_connection (
				user_id, source_user_id, access_token, refresh_token
			)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT (user_id) DO UPDATE
			SET
				source_user_id = EXCLUDED.source_user_id,
				access_token = EXCLUDED.access_token,
				refresh_token = EXCLUDED.refresh_token,
				token_version = donationalerts_connection.token_version + 1,
				updated_at = now()
		`, userID, connection.SourceUserID, connection.AccessToken, connection.RefreshToken); err != nil {
			return err
		}
		return insertDonations(ctx, tx, userID, donations)
	})
}

func insertDonations(ctx context.Context, tx pgx.Tx, userID int, donations []donationalerts.Donation) error {
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
			VALUES ('donationalerts', $1, $2, $3, $4, $5, $6, $7, $8)
			ON CONFLICT (user_id, source, source_donation_id) DO NOTHING
		`, donation.SourceDonationID, userID, donation.Author, donation.Message, donation.Amount, donation.Currency, donation.SourceCreatedAt, donation.OccurredAt); err != nil {
			return err
		}
	}
	return nil
}

func (store *Store) SetTokensIfVersion(ctx context.Context, userID, tokenVersion int, tokens donationalerts.Tokens) (bool, error) {
	command, err := store.pool.Exec(ctx, `
		UPDATE donationalerts_connection
		SET
			refresh_token = $1,
			access_token = $2,
			token_version = token_version + 1,
			updated_at = now()
		WHERE user_id = $3 AND token_version = $4
	`, tokens.RefreshToken, tokens.AccessToken, userID, tokenVersion)
	return command.RowsAffected() == 1, err
}

func (store *Store) Disconnect(ctx context.Context, userID int) error {
	_, err := store.pool.Exec(ctx, `
		DELETE FROM donationalerts_connection
		WHERE user_id = $1
	`, userID)
	return err
}

func (store *Store) DisconnectIfVersion(ctx context.Context, userID, tokenVersion int) (bool, error) {
	command, err := store.pool.Exec(ctx, `
		DELETE FROM donationalerts_connection
		WHERE user_id = $1 AND token_version = $2
	`, userID, tokenVersion)
	return command.RowsAffected() == 1, err
}

var _ persistence = (*Store)(nil)
