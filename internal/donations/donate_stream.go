package donations

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/lebedev-nikita/coldbrew/internal/donatestream"
)

type donateStreamProvider interface {
	IssueConnection(context.Context, string) (donatestream.Connection, error)
	Run(context.Context, string, func(donatestream.Donation) error) error
}

type donateStreamPersistence interface {
	DonateStreamConnections(context.Context) ([]DonateStreamConnection, error)
	SaveDonateStreamConnection(context.Context, int, donatestream.Connection) error
	InsertDonateStreamDonations(context.Context, int, []donatestream.Donation) error
	DisconnectDonateStream(context.Context, int) error
	DisconnectDonateStreamIfToken(context.Context, int, string) (bool, error)
}

type DonateStreamConnection struct {
	UserID         int
	WidgetGroupUID string
	WidgetToken    string
}

type DonateStreamApplication struct {
	store        donateStreamPersistence
	provider     donateStreamProvider
	refreshEvery time.Duration
}

func NewDonateStreamApplication(store *Store, source *donatestream.Source) *DonateStreamApplication {
	return newDonateStreamApplication(store, &DonateStreamAdapter{source: source})
}

func newDonateStreamApplication(store donateStreamPersistence, provider donateStreamProvider) *DonateStreamApplication {
	return &DonateStreamApplication{store: store, provider: provider, refreshEvery: 10 * time.Second}
}

func (application *DonateStreamApplication) Connect(ctx context.Context, userID int, widgetURL string) error {
	connection, err := application.provider.IssueConnection(ctx, widgetURL)
	if err != nil {
		return fmt.Errorf("issue donate.stream connection: %w", err)
	}
	if err := application.store.SaveDonateStreamConnection(ctx, userID, connection); err != nil {
		return fmt.Errorf("save donate.stream connection: %w", err)
	}
	return nil
}

func (application *DonateStreamApplication) Disconnect(ctx context.Context, userID int) error {
	return application.store.DisconnectDonateStream(ctx, userID)
}

type runningDonateStreamListener struct {
	cancel      context.CancelFunc
	widgetToken string
}

type donateStreamListenerCompletion struct {
	userID      int
	widgetToken string
	err         error
}

func (application *DonateStreamApplication) Run(ctx context.Context) error {
	running := make(map[int]runningDonateStreamListener)
	completed := make(chan donateStreamListenerCompletion)
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

	for {
		select {
		case <-ctx.Done():
			return nil
		case completion := <-completed:
			listener, exists := running[completion.userID]
			if exists && listener.widgetToken == completion.widgetToken {
				delete(running, completion.userID)
			}
			if completion.err != nil {
				slog.Error("donate.stream listener exited", "userId", completion.userID, "error", completion.err)
			}
		case <-refreshTicker.C:
			if err := application.refreshListeners(ctx, running, completed, &listeners); err != nil {
				slog.Error("refresh donate.stream listeners", "error", err)
			}
		}
	}
}

func (application *DonateStreamApplication) refreshListeners(ctx context.Context, running map[int]runningDonateStreamListener, completed chan<- donateStreamListenerCompletion, listeners *sync.WaitGroup) error {
	connections, err := application.store.DonateStreamConnections(ctx)
	if err != nil {
		return fmt.Errorf("get donate.stream connections: %w", err)
	}
	byUserID := make(map[int]DonateStreamConnection, len(connections))
	for _, connection := range connections {
		byUserID[connection.UserID] = connection
	}
	for userID, listener := range running {
		connection, exists := byUserID[userID]
		if !exists || connection.WidgetToken != listener.widgetToken {
			listener.cancel()
			delete(running, userID)
		}
	}
	for _, connection := range connections {
		if _, exists := running[connection.UserID]; exists {
			continue
		}
		listenerCtx, cancel := context.WithCancel(ctx)
		running[connection.UserID] = runningDonateStreamListener{cancel: cancel, widgetToken: connection.WidgetToken}
		listeners.Add(1)
		go func(connection DonateStreamConnection) {
			defer listeners.Done()
			err := application.listen(listenerCtx, connection)
			select {
			case completed <- donateStreamListenerCompletion{userID: connection.UserID, widgetToken: connection.WidgetToken, err: err}:
			case <-ctx.Done():
			}
		}(connection)
	}
	return nil
}

func (application *DonateStreamApplication) listen(ctx context.Context, connection DonateStreamConnection) error {
	err := application.provider.Run(ctx, connection.WidgetToken, func(donation donatestream.Donation) error {
		return application.store.InsertDonateStreamDonations(ctx, connection.UserID, []donatestream.Donation{donation})
	})
	if err == nil || ctx.Err() != nil {
		return nil
	}
	if !donateStreamUnauthorized(err) {
		return err
	}
	if _, disconnectErr := application.store.DisconnectDonateStreamIfToken(ctx, connection.UserID, connection.WidgetToken); disconnectErr != nil {
		return errors.Join(err, disconnectErr)
	}
	return err
}

func donateStreamInvalidInput(err error) bool {
	var requestError *donatestream.RequestError
	return errors.As(err, &requestError) && requestError.InvalidInput
}

func donateStreamUnauthorized(err error) bool {
	var requestError *donatestream.RequestError
	return errors.As(err, &requestError) && requestError.Unauthorized
}

type DonateStreamAdapter struct {
	source *donatestream.Source
}

func (adapter *DonateStreamAdapter) IssueConnection(ctx context.Context, widgetURL string) (donatestream.Connection, error) {
	connection, err := donatestream.ParseWidgetURL(widgetURL)
	if err != nil {
		return donatestream.Connection{}, err
	}
	if err := adapter.source.Authenticate(ctx, connection.WidgetToken); err != nil {
		return donatestream.Connection{}, err
	}
	return connection, nil
}

func (adapter *DonateStreamAdapter) Run(ctx context.Context, widgetToken string, emit func(donatestream.Donation) error) error {
	return adapter.source.Run(ctx, widgetToken, emit)
}

var _ donateStreamProvider = (*DonateStreamAdapter)(nil)
var _ donateStreamPersistence = (*Store)(nil)
