package donations

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/lebedev-nikita/coldbrew/internal/donationalerts"
)

type donationAlerts interface {
	IssueConnection(context.Context, donationalerts.Config, string, string) (donationalerts.Connection, error)
	RefreshTokens(context.Context, donationalerts.Config, string) (donationalerts.Tokens, error)
	GetDonations(context.Context, string) ([]donationalerts.Donation, error)
	Run(context.Context, string, func(donationalerts.Donation) error) error
}

type persistence interface {
	Connections(context.Context) ([]Connection, error)
	SaveConnectionWithDonations(context.Context, int, donationalerts.Connection, []donationalerts.Donation) error
	InsertDonations(context.Context, int, []donationalerts.Donation) error
	SetTokensIfVersion(context.Context, int, int, donationalerts.Tokens) (bool, error)
	Disconnect(context.Context, int) error
	DisconnectIfVersion(context.Context, int, int) (bool, error)
}

type Connection struct {
	UserID            int
	SourceUserID      string
	AccessToken       string
	RefreshToken      string
	TokenVersion      int
	HistoryCheckpoint *string
}

type Application struct {
	store        persistence
	provider     donationAlerts
	config       donationalerts.Config
	refreshEvery time.Duration
	historyEvery time.Duration
}

func NewApplication(store *Store, provider *DonationAlertsAdapter, config donationalerts.Config) *Application {
	return newApplication(store, provider, config)
}

func newApplication(store persistence, provider donationAlerts, config donationalerts.Config) *Application {
	return &Application{
		store: store, provider: provider, config: config,
		refreshEvery: 10 * time.Second,
		historyEvery: time.Hour,
	}
}

func (application *Application) Connect(ctx context.Context, userID int, authCode, redirectURI string) error {
	connection, err := application.provider.IssueConnection(ctx, application.config, authCode, redirectURI)
	if err != nil {
		return fmt.Errorf("issue DonationAlerts connection: %w", err)
	}
	donations, err := application.provider.GetDonations(ctx, connection.AccessToken)
	if err != nil {
		return fmt.Errorf("import initial DonationAlerts history: %w", err)
	}
	if err := application.store.SaveConnectionWithDonations(ctx, userID, connection, donations); err != nil {
		return fmt.Errorf("save DonationAlerts connection and history: %w", err)
	}
	return nil
}

func (application *Application) AuthorizationURL(redirectURI string) string {
	return donationalerts.AuthorizationURL(application.config.ClientID, redirectURI)
}

func (application *Application) Disconnect(ctx context.Context, userID int) error {
	return application.store.Disconnect(ctx, userID)
}

type runningListener struct {
	cancel       context.CancelFunc
	tokenVersion int
}

type listenerCompletion struct {
	userID       int
	tokenVersion int
	err          error
}

func (application *Application) Run(ctx context.Context) error {
	running := make(map[int]runningListener)
	completed := make(chan listenerCompletion)
	var listeners sync.WaitGroup
	defer func() {
		for _, listener := range running {
			listener.cancel()
		}
		listeners.Wait()
	}()

	if err := application.refreshListeners(ctx, running, completed, &listeners); err != nil {
		return err
	}
	refreshTicker := time.NewTicker(application.refreshEvery)
	defer refreshTicker.Stop()
	historyTicker := time.NewTicker(application.historyEvery)
	defer historyTicker.Stop()

	for {
		select {
		case <-ctx.Done():
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
			if err := application.refreshListeners(ctx, running, completed, &listeners); err != nil {
				slog.Error("refresh DonationAlerts listeners", "error", err)
			}
		case <-historyTicker.C:
			application.syncHistory(ctx)
		}
	}
}

func (application *Application) refreshListeners(ctx context.Context, running map[int]runningListener, completed chan<- listenerCompletion, listeners *sync.WaitGroup) error {
	connections, err := application.store.Connections(ctx)
	if err != nil {
		return fmt.Errorf("get DonationAlerts connections: %w", err)
	}
	byUserID := make(map[int]Connection, len(connections))
	for _, connection := range connections {
		byUserID[connection.UserID] = connection
	}
	for userID, listener := range running {
		connection, exists := byUserID[userID]
		if !exists || connection.TokenVersion != listener.tokenVersion {
			listener.cancel()
			delete(running, userID)
		}
	}
	for _, connection := range connections {
		if _, exists := running[connection.UserID]; exists {
			continue
		}
		listenerCtx, cancel := context.WithCancel(ctx)
		running[connection.UserID] = runningListener{cancel: cancel, tokenVersion: connection.TokenVersion}
		listeners.Add(1)
		go func(connection Connection) {
			defer listeners.Done()
			err := application.listen(listenerCtx, connection)
			select {
			case completed <- listenerCompletion{userID: connection.UserID, tokenVersion: connection.TokenVersion, err: err}:
			case <-ctx.Done():
			}
		}(connection)
	}
	return nil
}

var ErrStaleCredentials = errors.New("donationalerts: stale credentials")

func (application *Application) listen(ctx context.Context, connection Connection) error {
	accessToken := connection.AccessToken
	refreshToken := connection.RefreshToken
	tokenVersion := connection.TokenVersion
	for ctx.Err() == nil {
		err := application.provider.Run(ctx, accessToken, func(donation donationalerts.Donation) error {
			return application.store.InsertDonations(ctx, connection.UserID, []donationalerts.Donation{donation})
		})
		if err == nil || ctx.Err() != nil {
			return nil
		}
		if !unauthorized(err) {
			return err
		}
		tokens, refreshErr := application.provider.RefreshTokens(ctx, application.config, refreshToken)
		if refreshErr != nil {
			if unauthorized(refreshErr) {
				if _, disconnectErr := application.store.DisconnectIfVersion(ctx, connection.UserID, tokenVersion); disconnectErr != nil {
					return errors.Join(refreshErr, disconnectErr)
				}
			}
			return fmt.Errorf("refresh DonationAlerts tokens: %w", refreshErr)
		}
		updated, err := application.store.SetTokensIfVersion(ctx, connection.UserID, tokenVersion, tokens)
		if err != nil {
			return fmt.Errorf("save refreshed DonationAlerts tokens: %w", err)
		}
		if !updated {
			return ErrStaleCredentials
		}
		accessToken = tokens.AccessToken
		refreshToken = tokens.RefreshToken
		tokenVersion++
	}
	return nil
}

func (application *Application) syncHistory(ctx context.Context) {
	connections, err := application.store.Connections(ctx)
	if err != nil {
		slog.Error("get connections for DonationAlerts history", "error", err)
		return
	}
	for _, connection := range connections {
		donations, err := application.provider.GetDonations(ctx, connection.AccessToken)
		if err != nil {
			slog.Error("fetch DonationAlerts history", "userId", connection.UserID, "error", err)
			continue
		}
		if err := application.store.InsertDonations(ctx, connection.UserID, donations); err != nil {
			slog.Error("insert DonationAlerts history", "userId", connection.UserID, "error", err)
		}
	}
}

func unauthorized(err error) bool {
	var requestError *donationalerts.RequestError
	return errors.As(err, &requestError) && requestError.Unauthorized
}
