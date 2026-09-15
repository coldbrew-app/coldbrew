package donations

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/streambrew-app/streambrew/internal/tourniquet"
)

type tourniquetTestStore struct {
	savedConnection  *tourniquet.Connection
	savedOrigin      IngestionOrigin
	savedAcceptedAt  time.Time
	savedWidgetToken string
}

func (*tourniquetTestStore) TourniquetConnections(context.Context) ([]TourniquetConnection, error) {
	return nil, nil
}

func (store *tourniquetTestStore) SaveTourniquetConnection(_ context.Context, _ int, connection tourniquet.Connection) error {
	store.savedConnection = &connection
	return nil
}

func (store *tourniquetTestStore) InsertTourniquetDonations(_ context.Context, _ int, widgetToken string, _ []tourniquet.Donation, origin IngestionOrigin, acceptedAt time.Time) error {
	store.savedOrigin = origin
	store.savedAcceptedAt = acceptedAt
	store.savedWidgetToken = widgetToken
	return nil
}

func (*tourniquetTestStore) DisconnectTourniquet(context.Context, int) error { return nil }

type tourniquetTestProvider struct {
	connection tourniquet.Connection
	issuedURL  *string
	run        func(context.Context, string, func(tourniquet.Donation) error) error
}

func (provider *tourniquetTestProvider) IssueConnection(widgetURL string) (tourniquet.Connection, error) {
	if provider.issuedURL != nil {
		*provider.issuedURL = widgetURL
	}
	return provider.connection, nil
}

func (provider *tourniquetTestProvider) Run(ctx context.Context, widgetToken string, emit func(tourniquet.Donation) error) error {
	return provider.run(ctx, widgetToken, emit)
}

func TestTourniquetConnectValidatesWidgetBeforeSaving(t *testing.T) {
	store := &tourniquetTestStore{}
	connection := tourniquet.Connection{WidgetToken: "widget-token"}
	var issuedURL string
	application := newTourniquetApplication(store, &tourniquetTestProvider{connection: connection, issuedURL: &issuedURL})

	widgetURL := "https://tourniquet.app/widgets/alert/widget-token"
	if err := application.Connect(context.Background(), 42, widgetURL); err != nil {
		t.Fatal(err)
	}
	if issuedURL != widgetURL || store.savedConnection == nil || *store.savedConnection != connection {
		t.Fatalf("issuedURL=%q store=%#v", issuedURL, store)
	}
}

func TestTourniquetListenerUsesLiveOrigin(t *testing.T) {
	store := &tourniquetTestStore{}
	provider := &tourniquetTestProvider{
		run: func(_ context.Context, _ string, emit func(tourniquet.Donation) error) error {
			if err := emit(tourniquet.Donation{SourceDonationID: "live"}); err != nil {
				return err
			}
			return context.Canceled
		},
	}
	application := newTourniquetApplication(store, provider)
	acceptedAt := time.Date(2026, 9, 15, 12, 0, 0, 0, time.UTC)
	application.now = func() time.Time { return acceptedAt }
	err := application.listen(context.Background(), TourniquetConnection{UserID: 42, WidgetToken: "token"})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("error = %v", err)
	}
	if store.savedOrigin != LiveOrigin || !store.savedAcceptedAt.Equal(acceptedAt) || store.savedWidgetToken != "token" {
		t.Fatalf("origin=%q acceptedAt=%v widgetToken=%q", store.savedOrigin, store.savedAcceptedAt, store.savedWidgetToken)
	}
}
