package donations

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/streambrew-app/streambrew/internal/donatestream"
	"github.com/streambrew-app/streambrew/internal/donationalert"
	"github.com/streambrew-app/streambrew/internal/tourniquet"
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
	case DonateStreamSource, TourniquetSource:
		panic(source.displayName() + " uses its dedicated store")
	case StreamlabsSource:
		table = "streamlabs_connection"
	case StreamElementsSource:
		table = "streamelements_connection"
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
	statusFilter := ""
	if store.source == StreamElementsSource {
		statusFilter = "WHERE status = 'connected'"
	}
	rows, err := store.pool.Query(ctx, fmt.Sprintf(`
		SELECT user_id, source_user_id, access_token, refresh_token, token_version, history_checkpoint
		FROM %s
		%s
		ORDER BY user_id
	`, store.connectionTable, statusFilter))
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
	statusReset := ""
	if store.source == StreamElementsSource {
		statusReset = ",\n\t\t\t\tstatus = 'connected'"
	}
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
				updated_at = now()%s
		`, store.connectionTable, store.connectionTable, statusReset), userID, connection.SourceUserID, connection.AccessToken, connection.RefreshToken, batch.Checkpoint); err != nil {
			return err
		}
		return insertDonations(ctx, tx, store.source, userID, batch.Donations, InitialHistoryOrigin, time.Time{})
	})
}

func (store *providerStore) SaveDonations(ctx context.Context, userID, tokenVersion int, batch DonationBatch, origin IngestionOrigin, acceptedAt time.Time) error {
	statusFilter := ""
	if store.source == StreamElementsSource {
		statusFilter = " AND status = 'connected'"
	}
	return pgx.BeginFunc(ctx, store.pool, func(tx pgx.Tx) error {
		command, err := tx.Exec(ctx, fmt.Sprintf(`
			UPDATE %s
			SET
				history_checkpoint = coalesce($1, history_checkpoint),
				updated_at = CASE WHEN $1::text IS NULL THEN updated_at ELSE now() END
			WHERE user_id = $2 AND token_version = $3%s
		`, store.connectionTable, statusFilter), batch.Checkpoint, userID, tokenVersion)
		if err != nil {
			return err
		}
		if command.RowsAffected() != 1 {
			return ErrStaleCredentials
		}
		return insertDonations(ctx, tx, store.source, userID, batch.Donations, origin, acceptedAt)
	})
}

func insertDonations(ctx context.Context, tx pgx.Tx, source Source, userID int, donations []Donation, origin IngestionOrigin, acceptedAt time.Time) error {
	if !validIngestionOrigin(origin) {
		return fmt.Errorf("invalid donation ingestion origin %q", origin)
	}
	for _, donation := range orderedDonations(donations) {
		var donationID int64
		err := tx.QueryRow(ctx, `
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
			RETURNING donation_id
		`, source, donation.SourceDonationID, userID, donation.Author, donation.Message, donation.Amount, donation.Currency, donation.SourceCreatedAt, donation.OccurredAt).Scan(&donationID)
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return err
		}
		if origin != InitialHistoryOrigin {
			if err := donationalert.EnqueueIncoming(ctx, tx, userID, donationID, donationalert.Source(source), acceptedAt); err != nil {
				return err
			}
		}
	}
	return nil
}

func orderedDonations(donations []Donation) []Donation {
	ordered := slices.Clone(donations)
	slices.SortStableFunc(ordered, func(left, right Donation) int {
		if order := left.OccurredAt.Compare(right.OccurredAt); order != 0 {
			return order
		}
		return cmp.Compare(left.SourceDonationID, right.SourceDonationID)
	})
	return ordered
}

func (store *providerStore) SetTokensIfVersion(ctx context.Context, userID, tokenVersion int, tokens Tokens) (bool, error) {
	statusFilter := ""
	if store.source == StreamElementsSource {
		statusFilter = " AND status = 'connected'"
	}
	command, err := store.pool.Exec(ctx, fmt.Sprintf(`
		UPDATE %s
		SET
			refresh_token = $1,
			access_token = $2,
			token_version = token_version + 1,
			updated_at = now()
		WHERE user_id = $3 AND token_version = $4%s
	`, store.connectionTable, statusFilter), tokens.RefreshToken, tokens.AccessToken, userID, tokenVersion)
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

func (store *providerStore) RequireReauthorizationIfVersion(ctx context.Context, userID, tokenVersion int) (bool, error) {
	if store.source != StreamElementsSource {
		return store.DisconnectIfVersion(ctx, userID, tokenVersion)
	}
	command, err := store.pool.Exec(ctx, `
		UPDATE streamelements_connection
		SET
			status = 'reauthorization_required',
			updated_at = now()
		WHERE user_id = $1 AND token_version = $2 AND status = 'connected'
	`, userID, tokenVersion)
	if err != nil {
		return false, err
	}
	return command.RowsAffected() == 1, nil
}

func (store *providerStore) MarkConnectionErrorIfVersion(ctx context.Context, userID, tokenVersion int) (bool, error) {
	if store.source != StreamElementsSource {
		return false, nil
	}
	command, err := store.pool.Exec(ctx, `
		UPDATE streamelements_connection
		SET
			status = 'error',
			updated_at = now()
		WHERE user_id = $1 AND token_version = $2 AND status = 'connected'
	`, userID, tokenVersion)
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

func (store *Store) InsertDonateStreamDonations(ctx context.Context, userID int, widgetToken string, donations []donatestream.Donation, origin IngestionOrigin, acceptedAt time.Time) error {
	if len(donations) == 0 {
		return nil
	}
	return pgx.BeginFunc(ctx, store.pool, func(tx pgx.Tx) error {
		var connectionUserID int
		err := tx.QueryRow(ctx, `
			SELECT user_id
			FROM donate_stream_connection
			WHERE user_id = $1 AND widget_token = $2
			FOR UPDATE
		`, userID, widgetToken).Scan(&connectionUserID)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrStaleCredentials
		}
		if err != nil {
			return err
		}
		return insertDonateStreamDonations(ctx, tx, userID, donations, origin, acceptedAt)
	})
}

func insertDonateStreamDonations(ctx context.Context, tx pgx.Tx, userID int, donations []donatestream.Donation, origin IngestionOrigin, acceptedAt time.Time) error {
	if !validIngestionOrigin(origin) {
		return fmt.Errorf("invalid donation ingestion origin %q", origin)
	}
	for _, donation := range orderedDonateStreamDonations(donations) {
		var donationID int64
		err := tx.QueryRow(ctx, `
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
			RETURNING donation_id
		`, donation.SourceDonationID, userID, donation.Author, donation.Message, donation.Amount, donation.Currency, donation.SourceCreatedAt, donation.OccurredAt).Scan(&donationID)
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return err
		}
		if origin != InitialHistoryOrigin {
			if err := donationalert.EnqueueIncoming(ctx, tx, userID, donationID, donationalert.DonateStreamSource, acceptedAt); err != nil {
				return err
			}
		}
	}
	return nil
}

func orderedDonateStreamDonations(donations []donatestream.Donation) []donatestream.Donation {
	ordered := slices.Clone(donations)
	slices.SortStableFunc(ordered, func(left, right donatestream.Donation) int {
		if order := left.OccurredAt.Compare(right.OccurredAt); order != 0 {
			return order
		}
		return cmp.Compare(left.SourceDonationID, right.SourceDonationID)
	})
	return ordered
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

func (store *Store) TourniquetConnections(ctx context.Context) ([]TourniquetConnection, error) {
	rows, err := store.pool.Query(ctx, `
		SELECT user_id, widget_token
		FROM tourniquet_connection
		ORDER BY user_id
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	connections := make([]TourniquetConnection, 0)
	for rows.Next() {
		var connection TourniquetConnection
		if err := rows.Scan(&connection.UserID, &connection.WidgetToken); err != nil {
			return nil, err
		}
		connections = append(connections, connection)
	}
	return connections, rows.Err()
}

func (store *Store) SaveTourniquetConnection(ctx context.Context, userID int, connection tourniquet.Connection) error {
	_, err := store.pool.Exec(ctx, `
		INSERT INTO tourniquet_connection (user_id, widget_token)
		VALUES ($1, $2)
		ON CONFLICT (user_id) DO UPDATE
		SET
			widget_token = EXCLUDED.widget_token,
			updated_at = now()
	`, userID, connection.WidgetToken)
	return err
}

func (store *Store) InsertTourniquetDonations(ctx context.Context, userID int, widgetToken string, donations []tourniquet.Donation, origin IngestionOrigin, acceptedAt time.Time) error {
	if len(donations) == 0 {
		return nil
	}
	return pgx.BeginFunc(ctx, store.pool, func(tx pgx.Tx) error {
		var connectionUserID int
		err := tx.QueryRow(ctx, `
			SELECT user_id
			FROM tourniquet_connection
			WHERE user_id = $1 AND widget_token = $2
			FOR UPDATE
		`, userID, widgetToken).Scan(&connectionUserID)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrStaleCredentials
		}
		if err != nil {
			return err
		}
		values := make([]Donation, 0, len(donations))
		for _, donation := range donations {
			values = append(values, Donation{
				SourceDonationID: donation.SourceDonationID,
				Author:           donation.Author,
				Message:          donation.Message,
				Amount:           donation.Amount,
				Currency:         donation.Currency,
				SourceCreatedAt:  donation.SourceCreatedAt,
				OccurredAt:       donation.OccurredAt,
			})
		}
		return insertDonations(ctx, tx, TourniquetSource, userID, values, origin, acceptedAt)
	})
}

func (store *Store) DisconnectTourniquet(ctx context.Context, userID int) error {
	_, err := store.pool.Exec(ctx, `
		DELETE FROM tourniquet_connection
		WHERE user_id = $1
	`, userID)
	return err
}

var _ persistence = (*providerStore)(nil)
var _ donateStreamPersistence = (*Store)(nil)
var _ tourniquetPersistence = (*Store)(nil)
