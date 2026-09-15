package donations

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/streambrew-app/streambrew/internal/donatestream"
)

type donateStreamTestStore struct {
	savedConnection    *donatestream.Connection
	disconnectedUserID int
	disconnectedToken  string
	savedOrigin        IngestionOrigin
	savedAcceptedAt    time.Time
	savedWidgetToken   string
}

func (*donateStreamTestStore) DonateStreamConnections(context.Context) ([]DonateStreamConnection, error) {
	return nil, nil
}

func (store *donateStreamTestStore) SaveDonateStreamConnection(_ context.Context, _ int, connection donatestream.Connection) error {
	store.savedConnection = &connection
	return nil
}

func (store *donateStreamTestStore) InsertDonateStreamDonations(_ context.Context, _ int, widgetToken string, _ []donatestream.Donation, origin IngestionOrigin, acceptedAt time.Time) error {
	store.savedOrigin = origin
	store.savedAcceptedAt = acceptedAt
	store.savedWidgetToken = widgetToken
	return nil
}

func (*donateStreamTestStore) DisconnectDonateStream(context.Context, int) error { return nil }

func (store *donateStreamTestStore) DisconnectDonateStreamIfToken(_ context.Context, userID int, accessToken string) (bool, error) {
	store.disconnectedUserID = userID
	store.disconnectedToken = accessToken
	return true, nil
}

type donateStreamTestProvider struct {
	connection donatestream.Connection
	issuedURL  *string
	run        func(context.Context, string, func(donatestream.Donation) error) error
}

func (provider *donateStreamTestProvider) IssueConnection(_ context.Context, widgetURL string) (donatestream.Connection, error) {
	if provider.issuedURL != nil {
		*provider.issuedURL = widgetURL
	}
	return provider.connection, nil
}

func (provider *donateStreamTestProvider) Run(ctx context.Context, accessToken string, emit func(donatestream.Donation) error) error {
	return provider.run(ctx, accessToken, emit)
}

func TestDonateStreamConnectValidatesWidgetBeforeSaving(t *testing.T) {
	store := &donateStreamTestStore{}
	connection := donatestream.Connection{WidgetGroupUID: "group", WidgetToken: "widget-token"}
	var issuedURL string
	application := newDonateStreamApplication(store, &donateStreamTestProvider{
		connection: connection,
		issuedURL:  &issuedURL,
	})

	widgetURL := "https://donate.stream/widget-alert?uid=group&token=widget-token"
	if err := application.Connect(context.Background(), 42, widgetURL); err != nil {
		t.Fatal(err)
	}
	if issuedURL != widgetURL || store.savedConnection == nil || *store.savedConnection != connection {
		t.Fatalf("issuedURL=%q store=%#v", issuedURL, store)
	}
}

func TestDonateStreamUnauthorizedListenerDisconnectsOnlyMatchingToken(t *testing.T) {
	store := &donateStreamTestStore{}
	provider := &donateStreamTestProvider{
		run: func(context.Context, string, func(donatestream.Donation) error) error {
			return &donatestream.RequestError{Unauthorized: true, Operation: "test", Cause: errors.New("auth")}
		},
	}
	application := newDonateStreamApplication(store, provider)
	connection := DonateStreamConnection{UserID: 42, WidgetToken: "widget-token"}

	err := application.listen(context.Background(), connection)
	if !donateStreamUnauthorized(err) || store.disconnectedUserID != 42 || store.disconnectedToken != "widget-token" {
		t.Fatalf("err=%v store=%#v", err, store)
	}
}

func TestDonateStreamListenerUsesLiveOrigin(t *testing.T) {
	store := &donateStreamTestStore{}
	provider := &donateStreamTestProvider{
		run: func(_ context.Context, _ string, emit func(donatestream.Donation) error) error {
			if err := emit(donatestream.Donation{SourceDonationID: "live"}); err != nil {
				return err
			}
			return context.Canceled
		},
	}
	application := newDonateStreamApplication(store, provider)
	acceptedAt := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	application.now = func() time.Time { return acceptedAt }
	err := application.listen(context.Background(), DonateStreamConnection{UserID: 42, WidgetToken: "token"})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("error = %v", err)
	}
	if store.savedOrigin != LiveOrigin || !store.savedAcceptedAt.Equal(acceptedAt) || store.savedWidgetToken != "token" {
		t.Fatalf("origin=%q acceptedAt=%v widgetToken=%q", store.savedOrigin, store.savedAcceptedAt, store.savedWidgetToken)
	}
}
