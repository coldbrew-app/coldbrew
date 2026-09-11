package donations

import (
	"context"
	"errors"
	"testing"

	"github.com/lebedev-nikita/coldbrew/internal/donatestream"
)

type donateStreamTestStore struct {
	savedConnection    *donatestream.Connection
	disconnectedUserID int
	disconnectedToken  string
}

func (*donateStreamTestStore) DonateStreamConnections(context.Context) ([]DonateStreamConnection, error) {
	return nil, nil
}

func (store *donateStreamTestStore) SaveDonateStreamConnection(_ context.Context, _ int, connection donatestream.Connection) error {
	store.savedConnection = &connection
	return nil
}

func (*donateStreamTestStore) InsertDonateStreamDonations(context.Context, int, []donatestream.Donation) error {
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
