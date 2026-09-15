package donations

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/streambrew-app/streambrew/internal/donatestream"
)

type donateStreamProvider interface {
	IssueConnection(context.Context, string) (donatestream.Connection, error)
	Run(context.Context, string, func(donatestream.Donation) error) error
}

type donateStreamPersistence interface {
	DonateStreamConnections(context.Context) ([]DonateStreamConnection, error)
	SaveDonateStreamConnection(context.Context, int, donatestream.Connection) error
	InsertDonateStreamDonations(context.Context, int, string, []donatestream.Donation, IngestionOrigin, time.Time) error
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
	now          func() time.Time
}

func NewDonateStreamApplication(store *Store, source *donatestream.Source) *DonateStreamApplication {
	return newDonateStreamApplication(store, &DonateStreamAdapter{source: source})
}

func newDonateStreamApplication(store donateStreamPersistence, provider donateStreamProvider) *DonateStreamApplication {
	return &DonateStreamApplication{store: store, provider: provider, refreshEvery: 10 * time.Second, now: time.Now}
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

func (application *DonateStreamApplication) Run(ctx context.Context) error {
	return (liveListenerSupervisor{
		displayName:  "donate.stream",
		refreshEvery: application.refreshEvery,
		connections: func(ctx context.Context) ([]liveListenerConnection, error) {
			connections, err := application.store.DonateStreamConnections(ctx)
			values := make([]liveListenerConnection, 0, len(connections))
			for _, connection := range connections {
				values = append(values, liveListenerConnection{userID: connection.UserID, credential: connection.WidgetToken})
			}
			return values, err
		},
		listen: func(ctx context.Context, connection liveListenerConnection) error {
			return application.listen(ctx, DonateStreamConnection{UserID: connection.userID, WidgetToken: connection.credential})
		},
	}).Run(ctx)
}

func (application *DonateStreamApplication) listen(ctx context.Context, connection DonateStreamConnection) error {
	err := application.provider.Run(ctx, connection.WidgetToken, func(donation donatestream.Donation) error {
		return application.store.InsertDonateStreamDonations(ctx, connection.UserID, connection.WidgetToken, []donatestream.Donation{donation}, LiveOrigin, application.now())
	})
	if contextDone(ctx) {
		return nil
	}
	if err == nil {
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
