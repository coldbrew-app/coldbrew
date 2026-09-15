package donations

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/streambrew-app/streambrew/internal/donatestream"
	"github.com/streambrew-app/streambrew/internal/donationalert"
	"github.com/streambrew-app/streambrew/internal/tourniquet"
)

var donationTestSchemaSequence atomic.Uint64

type notifyingRecoveryStore struct {
	persistence
	saved chan<- error
}

func (store *notifyingRecoveryStore) SaveDonations(
	ctx context.Context,
	userID int,
	tokenVersion int,
	batch DonationBatch,
	origin IngestionOrigin,
	acceptedAt time.Time,
) error {
	err := store.persistence.SaveDonations(ctx, userID, tokenVersion, batch, origin, acceptedAt)
	select {
	case store.saved <- err:
	default:
	}
	return err
}

func TestIntegrationRunImmediatelyRecoversFreshDonationAfterRestart(t *testing.T) {
	store, pool := newDonationIntegrationStore(t)
	seedDonationUser(t, pool, 1)
	ctx := context.Background()
	alertStore := donationalert.NewStore(pool)
	settings := donationalert.DefaultSettings()
	settings.Enabled = true
	if _, err := alertStore.UpdateSettings(ctx, 1, settings); err != nil {
		t.Fatal(err)
	}

	providerStore := store.forSource(StreamlabsSource)
	checkpoint := "before-restart"
	connection := ProviderConnection{
		SourceUserID: "source-user",
		Tokens:       Tokens{AccessToken: "access", RefreshToken: "refresh"},
	}
	if err := providerStore.SaveConnectionWithDonations(ctx, 1, connection, DonationBatch{Checkpoint: &checkpoint}); err != nil {
		t.Fatal(err)
	}

	now := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	nextCheckpoint := "after-restart"
	provider := testProvider()
	provider.batch = DonationBatch{
		Donations: []Donation{
			testDonation("missed-before-restart", now.Add(-donationalert.MaxAlertAge+time.Second)),
		},
		Checkpoint: &nextCheckpoint,
	}
	provider.run = func(ctx context.Context, _ string, _ *string, _ func(DonationBatch) error) error {
		<-ctx.Done()
		return nil
	}

	saved := make(chan error, 1)
	integration := newIntegration(&notifyingRecoveryStore{persistence: providerStore, saved: saved}, provider)
	integration.historyEvery = time.Hour
	integration.now = func() time.Time { return now }
	runCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- integration.run(runCtx) }()

	select {
	case err := <-saved:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("startup history recovery did not run immediately")
	}
	if provider.historyAfter == nil || !provider.historyAfter.Equal(now.Add(-donationalert.MaxAlertAge)) {
		t.Fatalf("startup recovery cutoff = %v", provider.historyAfter)
	}
	assertPlaybackIDs(t, pool, []string{"missed-before-restart"})

	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("integration did not stop after cancellation")
	}
}

func TestIngestionSuppressesInitialHistoryAndQueuesNewDonationsOnceInOrder(t *testing.T) {
	store, pool := newDonationIntegrationStore(t)
	seedDonationUser(t, pool, 1)
	ctx := context.Background()
	alertStore := donationalert.NewStore(pool)
	settings := donationalert.DefaultSettings()
	settings.Enabled = true
	if _, err := alertStore.UpdateSettings(ctx, 1, settings); err != nil {
		t.Fatal(err)
	}

	now := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	providerStore := store.forSource(StreamlabsSource)
	history := DonationBatch{Donations: []Donation{
		testDonation("history-new", now.Add(-time.Minute)),
		testDonation("history-old", now.Add(-2*time.Minute)),
	}}
	connection := ProviderConnection{SourceUserID: "source-user", Tokens: Tokens{AccessToken: "access", RefreshToken: "refresh"}}
	if err := providerStore.SaveConnectionWithDonations(ctx, 1, connection, history); err != nil {
		t.Fatal(err)
	}
	assertPlaybackIDs(t, pool, nil)

	live := DonationBatch{Donations: []Donation{
		testDonation("live-new", now.Add(time.Second)),
		testDonation("live-old", now),
	}}
	if err := providerStore.SaveDonations(ctx, 1, 1, live, LiveOrigin, now.Add(2*time.Second)); err != nil {
		t.Fatal(err)
	}
	assertPlaybackIDs(t, pool, []string{"live-old", "live-new"})
	if err := providerStore.SaveDonations(ctx, 1, 1, live, RecoveryOrigin, now.Add(3*time.Second)); err != nil {
		t.Fatal(err)
	}
	assertPlaybackIDs(t, pool, []string{"live-old", "live-new"})

	recovery := DonationBatch{Donations: []Donation{
		testDonation("recovery-expired", now.Add(-11*time.Minute)),
		testDonation("recovery-fresh", now.Add(-time.Minute)),
	}}
	if err := providerStore.SaveDonations(ctx, 1, 1, recovery, RecoveryOrigin, now); err != nil {
		t.Fatal(err)
	}
	assertPlaybackIDs(t, pool, []string{"live-old", "live-new", "recovery-fresh"})
}

func TestDonateStreamIngestionRequiresCurrentConnectionToken(t *testing.T) {
	store, pool := newDonationIntegrationStore(t)
	seedDonationUser(t, pool, 1)
	ctx := context.Background()
	alertStore := donationalert.NewStore(pool)
	settings := donationalert.DefaultSettings()
	settings.Enabled = true
	if _, err := alertStore.UpdateSettings(ctx, 1, settings); err != nil {
		t.Fatal(err)
	}
	if err := store.SaveDonateStreamConnection(ctx, 1, donatestream.Connection{
		WidgetGroupUID: "group",
		WidgetToken:    "current-token",
	}); err != nil {
		t.Fatal(err)
	}

	now := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	donation := donatestream.Donation{
		SourceDonationID: "donate-stream-live",
		Amount:           "10.00",
		Currency:         "RUB",
		SourceCreatedAt:  now.Format(time.RFC3339Nano),
		OccurredAt:       now,
	}
	if err := store.InsertDonateStreamDonations(ctx, 1, "stale-token", []donatestream.Donation{donation}, LiveOrigin, now); !errors.Is(err, ErrStaleCredentials) {
		t.Fatalf("stale token error = %v", err)
	}
	assertPlaybackIDs(t, pool, nil)

	if err := store.InsertDonateStreamDonations(ctx, 1, "current-token", []donatestream.Donation{donation}, LiveOrigin, now); err != nil {
		t.Fatal(err)
	}
	assertPlaybackIDs(t, pool, []string{"donate-stream-live"})
}

func TestTourniquetIngestionIsIdempotentAndRequiresCurrentConnectionToken(t *testing.T) {
	store, pool := newDonationIntegrationStore(t)
	seedDonationUser(t, pool, 1)
	ctx := context.Background()
	alertStore := donationalert.NewStore(pool)
	settings := donationalert.DefaultSettings()
	settings.Enabled = true
	if _, err := alertStore.UpdateSettings(ctx, 1, settings); err != nil {
		t.Fatal(err)
	}
	if err := store.SaveTourniquetConnection(ctx, 1, tourniquet.Connection{WidgetToken: "current-token-1234"}); err != nil {
		t.Fatal(err)
	}

	now := time.Date(2026, 9, 15, 12, 0, 0, 0, time.UTC)
	donation := tourniquet.Donation{
		SourceDonationID: "tourniquet-live",
		Amount:           "0.00012345",
		Currency:         "USDT (TRX)",
		SourceCreatedAt:  "2026-09-15 12:00:00",
		OccurredAt:       now,
	}
	if err := store.InsertTourniquetDonations(ctx, 1, "stale-token-1234", []tourniquet.Donation{donation}, LiveOrigin, now); !errors.Is(err, ErrStaleCredentials) {
		t.Fatalf("stale token error = %v", err)
	}
	if err := store.InsertTourniquetDonations(ctx, 1, "current-token-1234", []tourniquet.Donation{donation, donation}, LiveOrigin, now); err != nil {
		t.Fatal(err)
	}
	assertPlaybackIDs(t, pool, []string{"tourniquet-live"})

	var amount, currency, sourceCreatedAt string
	if err := pool.QueryRow(ctx, `
		SELECT amount::text, currency::text, source_created_at
		FROM donation
		WHERE source = 'tourniquet' AND source_donation_id = 'tourniquet-live'
	`).Scan(&amount, &currency, &sourceCreatedAt); err != nil {
		t.Fatal(err)
	}
	if amount != "0.000123450000000000" || currency != "USDT (TRX)" || sourceCreatedAt != donation.SourceCreatedAt {
		t.Fatalf("amount=%q currency=%q sourceCreatedAt=%q", amount, currency, sourceCreatedAt)
	}
	var pendingVideoScans int
	if err := pool.QueryRow(ctx, `
		SELECT count(*)
		FROM donation_video_scan
		JOIN donation USING (donation_id)
		WHERE donation.source = 'tourniquet'
	`).Scan(&pendingVideoScans); err != nil {
		t.Fatal(err)
	}
	if pendingVideoScans != 1 {
		t.Fatalf("pending video scans = %d, want 1", pendingVideoScans)
	}
}

func TestIncomingAlertBoundsDonorControlledSnapshot(t *testing.T) {
	store, pool := newDonationIntegrationStore(t)
	seedDonationUser(t, pool, 1)
	ctx := context.Background()
	alertStore := donationalert.NewStore(pool)
	settings := donationalert.DefaultSettings()
	settings.Enabled = true
	if _, err := alertStore.UpdateSettings(ctx, 1, settings); err != nil {
		t.Fatal(err)
	}
	providerStore := store.forSource(StreamlabsSource)
	connection := ProviderConnection{
		SourceUserID: "source-user",
		Tokens:       Tokens{AccessToken: "access", RefreshToken: "refresh"},
	}
	if err := providerStore.SaveConnectionWithDonations(ctx, 1, connection, DonationBatch{}); err != nil {
		t.Fatal(err)
	}

	author := strings.Repeat("Ж", donationalert.MaxAlertAuthorRunes+5)
	message := strings.Repeat("🙂", donationalert.MaxAlertMessageRunes+5)
	now := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	donation := testDonation("bounded-snapshot", now)
	donation.Author = &author
	donation.Message = &message
	if err := providerStore.SaveDonations(
		ctx,
		1,
		1,
		DonationBatch{Donations: []Donation{donation}},
		LiveOrigin,
		now,
	); err != nil {
		t.Fatal(err)
	}

	dashboard, err := alertStore.Dashboard(ctx, 1, now)
	if err != nil {
		t.Fatal(err)
	}
	if len(dashboard.RecentPlaybacks) != 1 {
		t.Fatalf("recent playbacks = %d, want 1", len(dashboard.RecentPlaybacks))
	}
	playback := dashboard.RecentPlaybacks[0]
	if playback.Author == nil || utf8.RuneCountInString(*playback.Author) != donationalert.MaxAlertAuthorRunes {
		t.Fatalf("author snapshot length = %d", runeCount(playback.Author))
	}
	if playback.Message == nil || utf8.RuneCountInString(*playback.Message) != donationalert.MaxAlertMessageRunes {
		t.Fatalf("message snapshot length = %d", runeCount(playback.Message))
	}
	line, err := json.Marshal(donationalert.StreamEvent{Type: "playback", Playback: &playback})
	if err != nil {
		t.Fatal(err)
	}
	if len(line)+1 > 64*1024 {
		t.Fatalf("maximum donor-controlled stream record = %d bytes", len(line)+1)
	}
}

func runeCount(value *string) int {
	if value == nil {
		return 0
	}
	return utf8.RuneCountInString(*value)
}

func testDonation(id string, occurredAt time.Time) Donation {
	return Donation{
		SourceDonationID: id,
		Amount:           "10.00",
		Currency:         "RUB",
		SourceCreatedAt:  occurredAt.Format(time.RFC3339Nano),
		OccurredAt:       occurredAt,
	}
}

func assertPlaybackIDs(t *testing.T, pool *pgxpool.Pool, want []string) {
	t.Helper()
	rows, err := pool.Query(context.Background(), `
		SELECT donation.source_donation_id
		FROM donation_alert_playback AS playback
		JOIN donation USING (donation_id)
		ORDER BY playback.queue_sequence
	`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	got := make([]string, 0, len(want))
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		got = append(got, id)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if len(got) != len(want) {
		t.Fatalf("playback IDs = %#v, want %#v", got, want)
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("playback IDs = %#v, want %#v", got, want)
		}
	}
}

func newDonationIntegrationStore(t *testing.T) (*Store, *pgxpool.Pool) {
	t.Helper()
	databaseURL := os.Getenv("DONATION_ALERT_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DONATION_ALERT_TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	admin, adminErr := pgxpool.New(ctx, databaseURL)
	if adminErr != nil {
		t.Fatal(adminErr)
	}
	schema := fmt.Sprintf("donation_ingestion_test_%d_%d", os.Getpid(), donationTestSchemaSequence.Add(1))
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		admin.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = admin.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
		admin.Close()
	})
	database, parseErr := url.Parse(databaseURL)
	if parseErr != nil {
		t.Fatal(parseErr)
	}
	query := database.Query()
	query.Set("search_path", schema)
	database.RawQuery = query.Encode()
	repositoryRoot, rootErr := filepath.Abs("../..")
	if rootErr != nil {
		t.Fatal(rootErr)
	}
	//nolint:gosec // The executable path is anchored to this repository's dependency directory.
	command := exec.Command(filepath.Join(repositoryRoot, "node_modules", ".bin", "dbmate"), "--no-dump-schema", "up")
	command.Dir = repositoryRoot
	command.Env = append(os.Environ(), "DATABASE_URL="+database.String())
	if output, migrationErr := command.CombinedOutput(); migrationErr != nil {
		t.Fatalf("apply test migrations: %v\n%s", migrationErr, output)
	}
	pool, poolErr := pgxpool.New(ctx, database.String())
	if poolErr != nil {
		t.Fatal(poolErr)
	}
	t.Cleanup(pool.Close)
	return NewStore(pool), pool
}

func seedDonationUser(t *testing.T, pool *pgxpool.Pool, userID int) {
	t.Helper()
	authID := fmt.Sprintf("donation-user-%d", userID)
	email := fmt.Sprintf("donation-user-%d@example.com", userID)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `
		INSERT INTO auth_user (id, name, email, "emailVerified")
		VALUES ($1, 'Donation Test', $2, true)
	`, authID, email); err != nil {
		t.Fatal(err)
	}
	_, err := pool.Exec(ctx, `
		INSERT INTO "user" (user_id, auth_user_id)
		OVERRIDING SYSTEM VALUE
		VALUES ($1, $2)
	`, userID, authID)
	if err != nil {
		t.Fatal(err)
	}
}
