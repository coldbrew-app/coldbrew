package donations

import (
	"context"
	"errors"
	"sync"
	"testing"
)

type applicationTestStore struct {
	connections         []Connection
	savedConnection     *ProviderConnection
	savedBatch          DonationBatch
	disconnectedUser    int
	disconnectedVersion int
	setTokensUpdated    bool
}

func (store *applicationTestStore) Connections(context.Context) ([]Connection, error) {
	return append([]Connection(nil), store.connections...), nil
}
func (store *applicationTestStore) SaveConnectionWithDonations(_ context.Context, _ int, connection ProviderConnection, batch DonationBatch) error {
	store.savedConnection = &connection
	store.savedBatch = batch
	return nil
}
func (store *applicationTestStore) SaveDonations(_ context.Context, _ int, _ int, batch DonationBatch) error {
	store.savedBatch = batch
	return nil
}
func (store *applicationTestStore) SetTokensIfVersion(context.Context, int, int, Tokens) (bool, error) {
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

type unauthorizedTestError struct{}

func (*unauthorizedTestError) Error() string { return "unauthorized" }

type applicationTestProvider struct {
	source     Source
	connection ProviderConnection
	batch      DonationBatch
	historyErr error
	run        func(context.Context, string, *string, func(DonationBatch) error) error
	refresh    func(context.Context, string) (Tokens, error)
}

func (provider *applicationTestProvider) Source() Source { return provider.source }
func (*applicationTestProvider) AuthorizationURL(redirectURI, state string) string {
	return "https://provider.test/authorize?redirect_uri=" + redirectURI + "&state=" + state
}
func (provider *applicationTestProvider) IssueConnection(context.Context, string, string) (ProviderConnection, error) {
	return provider.connection, nil
}
func (provider *applicationTestProvider) GetDonations(context.Context, string, *string) (DonationBatch, error) {
	return provider.batch, provider.historyErr
}
func (provider *applicationTestProvider) Run(ctx context.Context, accessToken string, checkpoint *string, emit func(DonationBatch) error) error {
	return provider.run(ctx, accessToken, checkpoint, emit)
}
func (provider *applicationTestProvider) RefreshTokens(ctx context.Context, refreshToken string) (Tokens, error) {
	return provider.refresh(ctx, refreshToken)
}
func (*applicationTestProvider) Unauthorized(err error) bool {
	var unauthorized *unauthorizedTestError
	return errors.As(err, &unauthorized)
}

func testProvider() *applicationTestProvider {
	return &applicationTestProvider{source: StreamlabsSource}
}

func TestConnectImportsHistoryBeforeAtomicSave(t *testing.T) {
	store := &applicationTestStore{}
	donation := Donation{SourceDonationID: "donation-1"}
	connection := ProviderConnection{SourceUserID: "source-user", Tokens: Tokens{AccessToken: "access", RefreshToken: "refresh"}}
	provider := testProvider()
	provider.connection = connection
	provider.batch = DonationBatch{Donations: []Donation{donation}}
	integration := newIntegration(store, provider)
	if err := integration.connect(context.Background(), 42, "code", "https://coldbrew.test/callback"); err != nil {
		t.Fatal(err)
	}
	if store.savedConnection == nil || *store.savedConnection != connection || len(store.savedBatch.Donations) != 1 || store.savedBatch.Donations[0].SourceDonationID != "donation-1" {
		t.Fatalf("connection=%#v batch=%#v", store.savedConnection, store.savedBatch)
	}
}

func TestConnectHistoryFailureDoesNotSavePartialConnection(t *testing.T) {
	store := &applicationTestStore{}
	provider := testProvider()
	provider.connection = ProviderConnection{Tokens: Tokens{AccessToken: "access"}}
	provider.historyErr = errors.New("history unavailable")
	integration := newIntegration(store, provider)
	if err := integration.connect(context.Background(), 42, "code", "https://coldbrew.test/callback"); err == nil {
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
	provider := testProvider()
	provider.run = func(ctx context.Context, token string, _ *string, _ func(DonationBatch) error) error {
		started <- token
		<-ctx.Done()
		cancelled <- token
		return nil
	}
	provider.refresh = func(context.Context, string) (Tokens, error) { return Tokens{}, nil }
	integration := newIntegration(store, provider)
	running := make(map[int]runningListener)
	completed := make(chan listenerCompletion, 2)
	var listeners sync.WaitGroup
	ctx, cancel := context.WithCancel(context.Background())
	defer func() { cancel(); listeners.Wait() }()
	if err := integration.refreshListeners(ctx, running, completed, &listeners); err != nil {
		t.Fatal(err)
	}
	if token := <-started; token != "first" {
		t.Fatalf("first token = %q", token)
	}
	store.connections = []Connection{{UserID: 42, AccessToken: "second", TokenVersion: 2}}
	if err := integration.refreshListeners(ctx, running, completed, &listeners); err != nil {
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
	provider := testProvider()
	provider.run = func(context.Context, string, *string, func(DonationBatch) error) error {
		return &unauthorizedTestError{}
	}
	provider.refresh = func(context.Context, string) (Tokens, error) {
		return Tokens{AccessToken: "new-access", RefreshToken: "new-refresh"}, nil
	}
	integration := newIntegration(store, provider)
	err := integration.listen(context.Background(), Connection{UserID: 42, AccessToken: "old", RefreshToken: "old-refresh", TokenVersion: 3})
	if !errors.Is(err, ErrStaleCredentials) {
		t.Fatalf("error = %v", err)
	}
}

func TestUnauthorizedRefreshDisconnectsOnlyMatchingVersion(t *testing.T) {
	store := &applicationTestStore{}
	provider := testProvider()
	provider.run = func(context.Context, string, *string, func(DonationBatch) error) error {
		return &unauthorizedTestError{}
	}
	provider.refresh = func(context.Context, string) (Tokens, error) {
		return Tokens{}, &unauthorizedTestError{}
	}
	integration := newIntegration(store, provider)
	if err := integration.listen(context.Background(), Connection{UserID: 42, AccessToken: "old", RefreshToken: "old-refresh", TokenVersion: 7}); err == nil {
		t.Fatal("expected refresh failure")
	}
	if store.disconnectedUser != 42 || store.disconnectedVersion != 7 {
		t.Fatalf("conditional disconnect user=%d version=%d", store.disconnectedUser, store.disconnectedVersion)
	}
}

func TestListenerAdvancesHistoryCheckpointAfterPersist(t *testing.T) {
	checkpoint := "old"
	next := "new"
	store := &applicationTestStore{}
	provider := testProvider()
	provider.run = func(_ context.Context, _ string, received *string, emit func(DonationBatch) error) error {
		if received == nil || *received != checkpoint {
			t.Fatalf("checkpoint = %v", received)
		}
		if err := emit(DonationBatch{Checkpoint: &next}); err != nil {
			return err
		}
		return context.Canceled
	}
	provider.refresh = func(context.Context, string) (Tokens, error) { return Tokens{}, nil }
	integration := newIntegration(store, provider)
	if err := integration.listen(context.Background(), Connection{UserID: 42, AccessToken: "access", TokenVersion: 1, HistoryCheckpoint: &checkpoint}); !errors.Is(err, context.Canceled) {
		t.Fatalf("error = %v", err)
	}
	if store.savedBatch.Checkpoint == nil || *store.savedBatch.Checkpoint != next {
		t.Fatalf("saved checkpoint = %v", store.savedBatch.Checkpoint)
	}
}
