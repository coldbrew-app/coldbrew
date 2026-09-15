package donations

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/streambrew-app/streambrew/internal/tourniquet"
)

type tourniquetProvider interface {
	IssueConnection(string) (tourniquet.Connection, error)
	Run(context.Context, string, func(tourniquet.Donation) error) error
}

type tourniquetPersistence interface {
	TourniquetConnections(context.Context) ([]TourniquetConnection, error)
	SaveTourniquetConnection(context.Context, int, tourniquet.Connection) error
	InsertTourniquetDonations(context.Context, int, string, []tourniquet.Donation, IngestionOrigin, time.Time) error
	DisconnectTourniquet(context.Context, int) error
}

type TourniquetConnection struct {
	UserID      int
	WidgetToken string
}

type TourniquetApplication struct {
	store        tourniquetPersistence
	provider     tourniquetProvider
	refreshEvery time.Duration
	now          func() time.Time
}

func NewTourniquetApplication(store *Store, source *tourniquet.Source) *TourniquetApplication {
	return newTourniquetApplication(store, &TourniquetAdapter{source: source})
}

func newTourniquetApplication(store tourniquetPersistence, provider tourniquetProvider) *TourniquetApplication {
	return &TourniquetApplication{store: store, provider: provider, refreshEvery: 10 * time.Second, now: time.Now}
}

func (application *TourniquetApplication) Connect(ctx context.Context, userID int, widgetURL string) error {
	connection, err := application.provider.IssueConnection(widgetURL)
	if err != nil {
		return fmt.Errorf("issue Tourniquet connection: %w", err)
	}
	if err := application.store.SaveTourniquetConnection(ctx, userID, connection); err != nil {
		return fmt.Errorf("save Tourniquet connection: %w", err)
	}
	return nil
}

func (application *TourniquetApplication) Disconnect(ctx context.Context, userID int) error {
	return application.store.DisconnectTourniquet(ctx, userID)
}

func (application *TourniquetApplication) Run(ctx context.Context) error {
	return (liveListenerSupervisor{
		displayName:  "Tourniquet",
		refreshEvery: application.refreshEvery,
		connections: func(ctx context.Context) ([]liveListenerConnection, error) {
			connections, err := application.store.TourniquetConnections(ctx)
			values := make([]liveListenerConnection, 0, len(connections))
			for _, connection := range connections {
				values = append(values, liveListenerConnection{userID: connection.UserID, credential: connection.WidgetToken})
			}
			return values, err
		},
		listen: func(ctx context.Context, connection liveListenerConnection) error {
			return application.listen(ctx, TourniquetConnection{UserID: connection.userID, WidgetToken: connection.credential})
		},
	}).Run(ctx)
}

func (application *TourniquetApplication) listen(ctx context.Context, connection TourniquetConnection) error {
	err := application.provider.Run(ctx, connection.WidgetToken, func(donation tourniquet.Donation) error {
		return application.store.InsertTourniquetDonations(ctx, connection.UserID, connection.WidgetToken, []tourniquet.Donation{donation}, LiveOrigin, application.now())
	})
	if contextDone(ctx) {
		return nil
	}
	return err
}

func tourniquetInvalidInput(err error) bool {
	var requestError *tourniquet.RequestError
	return errors.As(err, &requestError) && requestError.InvalidInput
}

type TourniquetAdapter struct {
	source *tourniquet.Source
}

func (*TourniquetAdapter) IssueConnection(widgetURL string) (tourniquet.Connection, error) {
	return tourniquet.ParseWidgetURL(widgetURL)
}

func (adapter *TourniquetAdapter) Run(ctx context.Context, widgetToken string, emit func(tourniquet.Donation) error) error {
	return adapter.source.Run(ctx, widgetToken, emit)
}

var _ tourniquetProvider = (*TourniquetAdapter)(nil)
var _ tourniquetPersistence = (*Store)(nil)
