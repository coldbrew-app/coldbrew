package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lebedev-nikita/coldbrew/internal/donationalerts"
)

type authenticatedUser struct {
	UserID            int
	SourceUserID      string
	AccessToken       string
	RefreshToken      string
	TokenVersion      int
	HistoryCheckpoint *string
}

type store struct{ pool *pgxpool.Pool }

type runningListener struct {
	cancel       context.CancelFunc
	tokenVersion int
}

type listenerCompletion struct {
	userID       int
	tokenVersion int
	err          error
}

func main() {
	if err := run(); err != nil {
		slog.Error("Donations service stopped", "error", err)
		os.Exit(1)
	}
}

func run() error {
	serviceConfig, err := loadConfig()
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	pool, err := pgxpool.New(ctx, serviceConfig.databaseURL)
	if err != nil {
		return fmt.Errorf("connect to database: %w", err)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		return fmt.Errorf("ping database: %w", err)
	}

	serviceStore := &store{pool: pool}
	apiClient := donationalerts.NewClient(&http.Client{Timeout: 30 * time.Second})
	source := donationalerts.NewSource(apiClient)
	config := donationalerts.Config{ClientID: serviceConfig.clientID, ClientSecret: serviceConfig.clientSecret}
	return runWorker(ctx, serviceStore, apiClient, source, config)
}

type config struct {
	databaseURL  string
	clientID     string
	clientSecret string
}

func loadConfig() (config, error) {
	serviceConfig := config{
		databaseURL:  os.Getenv("DATABASE_URL"),
		clientID:     os.Getenv("DONATION_ALERTS_CLIENT_ID"),
		clientSecret: os.Getenv("DONATION_ALERTS_CLIENT_SECRET"),
	}
	if serviceConfig.databaseURL == "" || serviceConfig.clientID == "" || serviceConfig.clientSecret == "" {
		return config{}, errors.New("DATABASE_URL, DONATION_ALERTS_CLIENT_ID, and DONATION_ALERTS_CLIENT_SECRET are required")
	}
	if _, err := strconv.ParseUint(serviceConfig.clientID, 10, 64); err != nil {
		return config{}, errors.New("DONATION_ALERTS_CLIENT_ID must be numeric")
	}
	return serviceConfig, nil
}

func runWorker(ctx context.Context, serviceStore *store, apiClient *donationalerts.Client, source *donationalerts.Source, config donationalerts.Config) error {
	running := make(map[int]runningListener)
	completed := make(chan listenerCompletion)
	if err := refreshListeners(ctx, serviceStore, apiClient, source, config, running, completed); err != nil {
		return err
	}

	refreshTicker := time.NewTicker(10 * time.Second)
	defer refreshTicker.Stop()
	historyTimer := time.NewTimer(time.Until(time.Now().Truncate(time.Hour).Add(time.Hour)))
	defer historyTimer.Stop()
	for {
		select {
		case <-ctx.Done():
			for _, listener := range running {
				listener.cancel()
			}
			return nil
		case completion := <-completed:
			listener, exists := running[completion.userID]
			if exists && listener.tokenVersion == completion.tokenVersion {
				delete(running, completion.userID)
			}
			if completion.err != nil {
				slog.Error("DonationAlerts listener exited", "userId", completion.userID, "error", completion.err)
			}
		case <-refreshTicker.C:
			if err := refreshListeners(ctx, serviceStore, apiClient, source, config, running, completed); err != nil {
				slog.Error("refresh DonationAlerts listeners", "error", err)
			}
		case <-historyTimer.C:
			go syncHistory(ctx, serviceStore, apiClient)
			historyTimer.Reset(time.Until(time.Now().Truncate(time.Hour).Add(time.Hour)))
		}
	}
}

func refreshListeners(ctx context.Context, serviceStore *store, apiClient *donationalerts.Client, source *donationalerts.Source, config donationalerts.Config, running map[int]runningListener, completed chan<- listenerCompletion) error {
	users, err := serviceStore.getUsers(ctx)
	if err != nil {
		return fmt.Errorf("get DonationAlerts users: %w", err)
	}
	usersByID := make(map[int]authenticatedUser, len(users))
	for _, user := range users {
		usersByID[user.UserID] = user
	}
	for userID, listener := range running {
		user, exists := usersByID[userID]
		if !exists || user.TokenVersion != listener.tokenVersion {
			listener.cancel()
			delete(running, userID)
		}
	}
	for _, user := range users {
		if _, exists := running[user.UserID]; exists {
			continue
		}
		listenerCtx, cancel := context.WithCancel(ctx)
		running[user.UserID] = runningListener{cancel: cancel, tokenVersion: user.TokenVersion}
		go func() {
			err := listen(listenerCtx, serviceStore, apiClient, source, config, user)
			select {
			case completed <- listenerCompletion{userID: user.UserID, tokenVersion: user.TokenVersion, err: err}:
			case <-ctx.Done():
			}
		}()
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(50 * time.Millisecond):
		}
	}
	return nil
}

func listen(ctx context.Context, serviceStore *store, apiClient *donationalerts.Client, source *donationalerts.Source, config donationalerts.Config, user authenticatedUser) error {
	accessToken := user.AccessToken
	refreshToken := user.RefreshToken
	tokenVersion := user.TokenVersion
	for ctx.Err() == nil {
		err := source.Run(ctx, accessToken, func(donation donationalerts.Donation) error {
			return serviceStore.insertDonations(ctx, user.UserID, []donationalerts.Donation{donation})
		})
		if err == nil || ctx.Err() != nil {
			return nil
		}
		var requestError *donationalerts.RequestError
		if !errors.As(err, &requestError) || !requestError.Unauthorized {
			return err
		}
		tokens, refreshErr := apiClient.RefreshTokens(ctx, config, refreshToken)
		if refreshErr != nil {
			var refreshRequestError *donationalerts.RequestError
			if errors.As(refreshErr, &refreshRequestError) && refreshRequestError.Unauthorized {
				if disconnectErr := serviceStore.disconnectIfVersion(ctx, user.UserID, tokenVersion); disconnectErr != nil {
					return errors.Join(refreshErr, disconnectErr)
				}
			}
			return fmt.Errorf("refresh DonationAlerts tokens: %w", refreshErr)
		}
		updated, err := serviceStore.setTokens(ctx, user.UserID, tokenVersion, tokens)
		if err != nil {
			return err
		}
		if !updated {
			return errors.New("donationalerts: stale credentials")
		}
		accessToken = tokens.AccessToken
		refreshToken = tokens.RefreshToken
		tokenVersion++
	}
	return nil
}

func syncHistory(ctx context.Context, serviceStore *store, apiClient *donationalerts.Client) {
	users, err := serviceStore.getUsers(ctx)
	if err != nil {
		slog.Error("get users for DonationAlerts history", "error", err)
		return
	}
	for _, user := range users {
		donations, err := apiClient.GetDonations(ctx, user.AccessToken)
		if err != nil {
			slog.Error("fetch DonationAlerts history", "userId", user.UserID, "error", err)
			continue
		}
		if err := serviceStore.insertDonations(ctx, user.UserID, donations); err != nil {
			slog.Error("insert DonationAlerts history", "userId", user.UserID, "error", err)
		}
	}
}

func (serviceStore *store) getUsers(ctx context.Context) ([]authenticatedUser, error) {
	rows, err := serviceStore.pool.Query(ctx, `
		SELECT user_id, source_user_id, access_token, refresh_token, token_version, history_checkpoint
		FROM donationalerts_connection
		ORDER BY user_id
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	users := make([]authenticatedUser, 0)
	for rows.Next() {
		var user authenticatedUser
		if err := rows.Scan(&user.UserID, &user.SourceUserID, &user.AccessToken, &user.RefreshToken, &user.TokenVersion, &user.HistoryCheckpoint); err != nil {
			return nil, err
		}
		users = append(users, user)
	}
	return users, rows.Err()
}

func (serviceStore *store) insertDonations(ctx context.Context, userID int, donations []donationalerts.Donation) error {
	if len(donations) == 0 {
		return nil
	}
	return pgx.BeginFunc(ctx, serviceStore.pool, func(tx pgx.Tx) error {
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

func (serviceStore *store) SaveConnectionWithDonations(ctx context.Context, userID int, connection donationalerts.Connection, donations []donationalerts.Donation) error {
	return pgx.BeginFunc(ctx, serviceStore.pool, func(tx pgx.Tx) error {
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

func (serviceStore *store) Disconnect(ctx context.Context, userID int) error {
	_, err := serviceStore.pool.Exec(ctx, `
		DELETE FROM donationalerts_connection
		WHERE user_id = $1
	`, userID)
	return err
}

func (serviceStore *store) setTokens(ctx context.Context, userID, tokenVersion int, tokens donationalerts.Tokens) (bool, error) {
	command, err := serviceStore.pool.Exec(ctx, `
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

func (serviceStore *store) disconnectIfVersion(ctx context.Context, userID, tokenVersion int) error {
	_, err := serviceStore.pool.Exec(ctx, `
		DELETE FROM donationalerts_connection
		WHERE user_id = $1 AND token_version = $2
	`, userID, tokenVersion)
	return err
}
