package donations

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/lebedev-nikita/coldbrew/internal/donationalerts"
)

type applicationTestStore struct {
	connections         []Connection
	savedConnection     *donationalerts.Connection
	savedDonations      []donationalerts.Donation
	disconnectedUser    int
	disconnectedVersion int
	setTokensUpdated    bool
}

func (store *applicationTestStore) Connections(context.Context) ([]Connection, error) {
	return append([]Connection(nil), store.connections...), nil
}
func (store *applicationTestStore) SaveConnectionWithDonations(_ context.Context, _ int, connection donationalerts.Connection, donations []donationalerts.Donation) error {
	store.savedConnection = &connection
	store.savedDonations = append([]donationalerts.Donation(nil), donations...)
	return nil
}
func (*applicationTestStore) InsertDonations(context.Context, int, []donationalerts.Donation) error {
	return nil
}
func (store *applicationTestStore) SetTokensIfVersion(context.Context, int, int, donationalerts.Tokens) (bool, error) {
	return store.setTokensUpdated, nil
}
func (store *applicationTestStore) Disconnect(_ context.Context, userID int) error {
	store.disconnectedUser = userID
	return nil
}
func (store *applicationTestStore) DisconnectIfVersion(_ context.Context, userID, tokenVersion int) (bool, error) {
	store.disconnectedUser = userID
	store.disconnectedVersion = tokenVersion
	return true, nil
}

type applicationTestProvider struct {
	connection donationalerts.Connection
	donations  []donationalerts.Donation
	historyErr error
	run        func(context.Context, string, func(donationalerts.Donation) error) error
	refresh    func(context.Context, donationalerts.Config, string) (donationalerts.Tokens, error)
}

func (provider *applicationTestProvider) IssueConnection(context.Context, donationalerts.Config, string, string) (donationalerts.Connection, error) {
	return provider.connection, nil
}
func (provider *applicationTestProvider) GetDonations(context.Context, string) ([]donationalerts.Donation, error) {
	return append([]donationalerts.Donation(nil), provider.donations...), provider.historyErr
}
func (provider *applicationTestProvider) Run(ctx context.Context, accessToken string, emit func(donationalerts.Donation) error) error {
	return provider.run(ctx, accessToken, emit)
}
func (provider *applicationTestProvider) RefreshTokens(ctx context.Context, config donationalerts.Config, refreshToken string) (donationalerts.Tokens, error) {
	return provider.refresh(ctx, config, refreshToken)
}

func TestConnectImportsHistoryBeforeAtomicSave(t *testing.T) {
	store := &applicationTestStore{}
	donation := donationalerts.Donation{SourceDonationID: "donation-1"}
	connection := donationalerts.Connection{SourceUserID: "source-user", Tokens: donationalerts.Tokens{AccessToken: "access", RefreshToken: "refresh"}}
	application := newApplication(store, &applicationTestProvider{connection: connection, donations: []donationalerts.Donation{donation}}, donationalerts.Config{})
	if err := application.Connect(context.Background(), 42, "code", "https://coldbrew.test/callback"); err != nil {
		t.Fatal(err)
	}
	if store.savedConnection == nil || *store.savedConnection != connection || len(store.savedDonations) != 1 || store.savedDonations[0].SourceDonationID != "donation-1" {
		t.Fatalf("connection=%#v donations=%#v", store.savedConnection, store.savedDonations)
	}
}

func TestConnectHistoryFailureDoesNotSavePartialConnection(t *testing.T) {
	store := &applicationTestStore{}
	application := newApplication(store, &applicationTestProvider{connection: donationalerts.Connection{Tokens: donationalerts.Tokens{AccessToken: "access"}}, historyErr: errors.New("history unavailable")}, donationalerts.Config{})
	if err := application.Connect(context.Background(), 42, "code", "https://coldbrew.test/callback"); err == nil {
		t.Fatal("expected history failure")
	}
	if store.savedConnection != nil {
		t.Fatal("connection was saved before history completed")
	}
}

func TestRefreshListenersReplacesListenerAfterReconnect(t *testing.T) {
	store := &applicationTestStore{connections: []Connection{{UserID: 42, AccessToken: "first", TokenVersion: 1}}}
	started := make(chan string, 2)
	cancelled := make(chan string, 2)
	provider := &applicationTestProvider{
		run: func(ctx context.Context, token string, _ func(donationalerts.Donation) error) error {
			started <- token
			<-ctx.Done()
			cancelled <- token
			return nil
		},
		refresh: func(context.Context, donationalerts.Config, string) (donationalerts.Tokens, error) {
			return donationalerts.Tokens{}, nil
		},
	}
	application := newApplication(store, provider, donationalerts.Config{})
	running := make(map[int]runningListener)
	completed := make(chan listenerCompletion, 2)
	var listeners sync.WaitGroup
	ctx, cancel := context.WithCancel(context.Background())
	defer func() { cancel(); listeners.Wait() }()
	if err := application.refreshListeners(ctx, running, completed, &listeners); err != nil {
		t.Fatal(err)
	}
	if token := <-started; token != "first" {
		t.Fatalf("first token = %q", token)
	}
	store.connections = []Connection{{UserID: 42, AccessToken: "second", TokenVersion: 2}}
	if err := application.refreshListeners(ctx, running, completed, &listeners); err != nil {
		t.Fatal(err)
	}
	if token := <-cancelled; token != "first" {
		t.Fatalf("cancelled token = %q", token)
	}
	if token := <-started; token != "second" || running[42].tokenVersion != 2 {
		t.Fatalf("replacement token=%q listener=%#v", token, running[42])
	}
}

func TestListenerRejectsStaleRefresh(t *testing.T) {
	store := &applicationTestStore{setTokensUpdated: false}
	provider := &applicationTestProvider{
		run: func(context.Context, string, func(donationalerts.Donation) error) error { return unauthorizedError() },
		refresh: func(context.Context, donationalerts.Config, string) (donationalerts.Tokens, error) {
			return donationalerts.Tokens{AccessToken: "new-access", RefreshToken: "new-refresh"}, nil
		},
	}
	application := newApplication(store, provider, donationalerts.Config{})
	err := application.listen(context.Background(), Connection{UserID: 42, AccessToken: "old", RefreshToken: "old-refresh", TokenVersion: 3})
	if !errors.Is(err, ErrStaleCredentials) {
		t.Fatalf("error = %v", err)
	}
}

func TestUnauthorizedRefreshDisconnectsOnlyMatchingVersion(t *testing.T) {
	store := &applicationTestStore{}
	provider := &applicationTestProvider{
		run: func(context.Context, string, func(donationalerts.Donation) error) error { return unauthorizedError() },
		refresh: func(context.Context, donationalerts.Config, string) (donationalerts.Tokens, error) {
			return donationalerts.Tokens{}, unauthorizedError()
		},
	}
	application := newApplication(store, provider, donationalerts.Config{})
	if err := application.listen(context.Background(), Connection{UserID: 42, AccessToken: "old", RefreshToken: "old-refresh", TokenVersion: 7}); err == nil {
		t.Fatal("expected refresh failure")
	}
	if store.disconnectedUser != 42 || store.disconnectedVersion != 7 {
		t.Fatalf("conditional disconnect user=%d version=%d", store.disconnectedUser, store.disconnectedVersion)
	}
}

func unauthorizedError() error {
	return &donationalerts.RequestError{Unauthorized: true, Status: 401, Operation: "test"}
}
