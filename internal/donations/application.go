package donations

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"
)

type persistence interface {
	Connections(context.Context) ([]Connection, error)
	SaveConnectionWithDonations(context.Context, int, ProviderConnection, DonationBatch) error
	SaveDonations(context.Context, int, int, DonationBatch) error
	SetTokensIfVersion(context.Context, int, int, Tokens) (bool, error)
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

type integration struct {
	store        persistence
	provider     provider
	refreshEvery time.Duration
	historyEvery time.Duration
}

func newIntegration(store persistence, provider provider) *integration {
	return &integration{
		store: store, provider: provider,
		refreshEvery: 10 * time.Second,
		historyEvery: time.Hour,
	}
}

type Application struct {
	integrations map[Source]*integration
	order        []Source
}

func NewApplication(store *Store, providers ...provider) *Application {
	application := &Application{integrations: make(map[Source]*integration, len(providers))}
	for _, configured := range providers {
		source := configured.Source()
		if _, exists := application.integrations[source]; exists {
			panic("duplicate donation provider: " + source)
		}
		application.integrations[source] = newIntegration(store.forSource(source), configured)
		application.order = append(application.order, source)
	}
	return application
}

func (application *Application) AuthorizationURL(source Source, redirectURI, state string) (string, error) {
	integration, err := application.integration(source)
	if err != nil {
		return "", err
	}
	return integration.provider.AuthorizationURL(redirectURI, state), nil
}

func (application *Application) Connect(ctx context.Context, source Source, userID int, authCode, redirectURI string) error {
	integration, err := application.integration(source)
	if err != nil {
		return err
	}
	return integration.connect(ctx, userID, authCode, redirectURI)
}

func (application *Application) Disconnect(ctx context.Context, source Source, userID int) error {
	integration, err := application.integration(source)
	if err != nil {
		return err
	}
	return integration.store.Disconnect(ctx, userID)
}

func (application *Application) integration(source Source) (*integration, error) {
	configured, ok := application.integrations[source]
	if !ok {
		return nil, fmt.Errorf("donations: provider %q is not configured", source)
	}
	return configured, nil
}

func (application *Application) Run(ctx context.Context) error {
	workerCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	results := make(chan error, len(application.order))
	var workers sync.WaitGroup
	for _, source := range application.order {
		configured := application.integrations[source]
		workers.Add(1)
		go func() {
			defer workers.Done()
			results <- configured.run(workerCtx)
		}()
	}

	select {
	case <-ctx.Done():
		cancel()
		workers.Wait()
		return nil
	case err := <-results:
		cancel()
		workers.Wait()
		if err == nil {
			return errors.New("donation provider worker stopped unexpectedly")
		}
		return err
	}
}

func (integration *integration) connect(ctx context.Context, userID int, authCode, redirectURI string) error {
	name := integration.provider.Source().displayName()
	connection, err := integration.provider.IssueConnection(ctx, authCode, redirectURI)
	if err != nil {
		return fmt.Errorf("issue %s connection: %w", name, err)
	}
	batch, err := integration.provider.GetDonations(ctx, connection.AccessToken, nil)
	if err != nil {
		return fmt.Errorf("import initial %s history: %w", name, err)
	}
	if err := integration.store.SaveConnectionWithDonations(ctx, userID, connection, batch); err != nil {
		return fmt.Errorf("save %s connection and history: %w", name, err)
	}
	return nil
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

func (integration *integration) run(ctx context.Context) error {
	running := make(map[int]runningListener)
	completed := make(chan listenerCompletion)
	var listeners sync.WaitGroup
	defer func() {
		for _, listener := range running {
			listener.cancel()
		}
		listeners.Wait()
	}()

	if err := integration.refreshListeners(ctx, running, completed, &listeners); err != nil {
		return err
	}
	refreshTicker := time.NewTicker(integration.refreshEvery)
	defer refreshTicker.Stop()
	historyTicker := time.NewTicker(integration.historyEvery)
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
				slog.Error(integration.provider.Source().displayName()+" listener exited", "userId", completion.userID, "error", completion.err)
			}
		case <-refreshTicker.C:
			if err := integration.refreshListeners(ctx, running, completed, &listeners); err != nil {
				slog.Error("refresh "+integration.provider.Source().displayName()+" listeners", "error", err)
			}
		case <-historyTicker.C:
			integration.syncHistory(ctx)
		}
	}
}

func (integration *integration) refreshListeners(ctx context.Context, running map[int]runningListener, completed chan<- listenerCompletion, listeners *sync.WaitGroup) error {
	connections, err := integration.store.Connections(ctx)
	if err != nil {
		return fmt.Errorf("get %s connections: %w", integration.provider.Source().displayName(), err)
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
			err := integration.listen(listenerCtx, connection)
			select {
			case completed <- listenerCompletion{userID: connection.UserID, tokenVersion: connection.TokenVersion, err: err}:
			case <-ctx.Done():
			}
		}(connection)
	}
	return nil
}

var ErrStaleCredentials = errors.New("donations: stale credentials")

func (integration *integration) listen(ctx context.Context, connection Connection) error {
	accessToken := connection.AccessToken
	refreshToken := connection.RefreshToken
	tokenVersion := connection.TokenVersion
	checkpoint := connection.HistoryCheckpoint
	for ctx.Err() == nil {
		err := integration.provider.Run(ctx, accessToken, checkpoint, func(batch DonationBatch) error {
			if err := integration.store.SaveDonations(ctx, connection.UserID, tokenVersion, batch); err != nil {
				return err
			}
			checkpoint = batch.Checkpoint
			return nil
		})
		if err == nil || ctx.Err() != nil {
			return nil
		}
		if !integration.provider.Unauthorized(err) {
			return err
		}
		tokens, refreshErr := integration.provider.RefreshTokens(ctx, refreshToken)
		if refreshErr != nil {
			if integration.provider.Unauthorized(refreshErr) {
				if _, disconnectErr := integration.store.DisconnectIfVersion(ctx, connection.UserID, tokenVersion); disconnectErr != nil {
					return errors.Join(refreshErr, disconnectErr)
				}
			}
			return fmt.Errorf("refresh %s tokens: %w", integration.provider.Source().displayName(), refreshErr)
		}
		updated, err := integration.store.SetTokensIfVersion(ctx, connection.UserID, tokenVersion, tokens)
		if err != nil {
			return fmt.Errorf("save refreshed %s tokens: %w", integration.provider.Source().displayName(), err)
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

func (integration *integration) syncHistory(ctx context.Context) {
	name := integration.provider.Source().displayName()
	connections, err := integration.store.Connections(ctx)
	if err != nil {
		slog.Error("get connections for "+name+" history", "error", err)
		return
	}
	for _, connection := range connections {
		batch, err := integration.provider.GetDonations(ctx, connection.AccessToken, connection.HistoryCheckpoint)
		if err != nil {
			slog.Error("fetch "+name+" history", "userId", connection.UserID, "error", err)
			continue
		}
		if err := integration.store.SaveDonations(ctx, connection.UserID, connection.TokenVersion, batch); err != nil {
			slog.Error("insert "+name+" history", "userId", connection.UserID, "error", err)
		}
	}
}
