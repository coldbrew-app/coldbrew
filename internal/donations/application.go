package donations

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/lebedev-nikita/coldbrew/internal/donationalert"
)

type persistence interface {
	Connections(context.Context) ([]Connection, error)
	SaveConnectionWithDonations(context.Context, int, ProviderConnection, DonationBatch) error
	SaveDonations(context.Context, int, int, DonationBatch, IngestionOrigin, time.Time) error
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

const (
	recentRecoveryConcurrency = 4
	recentRecoveryTimeout     = 45 * time.Second
)

type integration struct {
	store           persistence
	provider        provider
	refreshEvery    time.Duration
	recoveryEvery   time.Duration
	recoveryLimit   int
	recoveryTimeout time.Duration
	historyEvery    time.Duration
	now             func() time.Time
}

func newIntegration(store persistence, provider provider) *integration {
	return &integration{
		store: store, provider: provider,
		refreshEvery:    10 * time.Second,
		recoveryEvery:   donationalert.MaxAlertAge / 2,
		recoveryLimit:   recentRecoveryConcurrency,
		recoveryTimeout: recentRecoveryTimeout,
		historyEvery:    time.Hour,
		now:             time.Now,
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
	batch, err := integration.provider.GetDonations(ctx, connection.AccessToken, nil, nil)
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
	var historyWorkers sync.WaitGroup
	historyWorkers.Add(2)
	go func() {
		defer historyWorkers.Done()
		// Start with the bounded freshness window. A full account history can be
		// arbitrarily large and must not delay listener lifecycle management.
		integration.syncRecentHistory(ctx)
		ticker := time.NewTicker(integration.recoveryEvery)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				integration.syncRecentHistory(ctx)
			}
		}
	}()
	go func() {
		defer historyWorkers.Done()
		timer := time.NewTimer(integration.historyEvery)
		defer timer.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
				integration.syncHistory(ctx, false)
				timer.Reset(integration.historyEvery)
			}
		}
	}()
	defer historyWorkers.Wait()

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
			if err := integration.store.SaveDonations(ctx, connection.UserID, tokenVersion, batch, LiveOrigin, integration.now()); err != nil {
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

func (integration *integration) syncRecentHistory(ctx context.Context) {
	integration.syncHistory(ctx, true)
}

func (integration *integration) syncHistory(ctx context.Context, recent bool) {
	name := integration.provider.Source().displayName()
	connections, err := integration.store.Connections(ctx)
	if err != nil {
		if ctx.Err() == nil {
			slog.Error("get connections for "+name+" history", "error", err)
		}
		return
	}
	workerLimit := 1
	accountTimeout := time.Duration(0)
	if recent {
		workerLimit = integration.recoveryLimit
		accountTimeout = integration.recoveryTimeout
	}
	if workerLimit > len(connections) {
		workerLimit = len(connections)
	}
	if workerLimit == 0 {
		return
	}
	jobs := make(chan Connection, len(connections))
	for _, connection := range connections {
		jobs <- connection
	}
	close(jobs)
	var workers sync.WaitGroup
	workers.Add(workerLimit)
	for range workerLimit {
		go func() {
			defer workers.Done()
			for connection := range jobs {
				integration.syncConnectionHistory(ctx, name, connection, recent, accountTimeout)
			}
		}()
	}
	workers.Wait()
}

func (integration *integration) syncConnectionHistory(ctx context.Context, name string, connection Connection, recent bool, timeout time.Duration) {
	accountCtx := ctx
	cancel := func() {}
	if timeout > 0 {
		accountCtx, cancel = context.WithTimeout(ctx, timeout)
	}
	defer cancel()
	var occurredAfter *time.Time
	if recent {
		cutoff := integration.now().Add(-donationalert.MaxAlertAge)
		occurredAfter = &cutoff
	}
	batch, err := integration.provider.GetDonations(accountCtx, connection.AccessToken, connection.HistoryCheckpoint, occurredAfter)
	if err != nil {
		if ctx.Err() == nil {
			slog.Error("fetch "+name+" history", "userId", connection.UserID, "error", err)
		}
		return
	}
	if err := integration.store.SaveDonations(accountCtx, connection.UserID, connection.TokenVersion, batch, RecoveryOrigin, integration.now()); err != nil && ctx.Err() == nil {
		slog.Error("insert "+name+" history", "userId", connection.UserID, "error", err)
	}
}
