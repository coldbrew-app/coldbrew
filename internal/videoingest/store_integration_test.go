package videoingest

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

var testSchemaSequence atomic.Uint64

func TestBackfillEnqueuesOnlyUnparsedDonations(t *testing.T) {
	store, pool := newIntegrationStore(t)
	seedDonationWithoutScan(t, pool, 1)
	seedDonationWithoutScan(t, pool, 2)
	if _, err := pool.Exec(context.Background(), `UPDATE donation SET videos_parsed_at = now() WHERE donation_id = 2`); err != nil {
		t.Fatal(err)
	}
	if err := store.Backfill(context.Background()); err != nil {
		t.Fatal(err)
	}
	var donationIDs []int64
	rows, err := pool.Query(context.Background(), `SELECT donation_id FROM donation_video_scan ORDER BY donation_id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var donationID int64
		if err := rows.Scan(&donationID); err != nil {
			t.Fatal(err)
		}
		donationIDs = append(donationIDs, donationID)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if len(donationIDs) != 1 || donationIDs[0] != 1 {
		t.Fatalf("backfilled donation IDs = %#v", donationIDs)
	}
}

func TestConcurrentClaimsAreExclusive(t *testing.T) {
	store, pool := newIntegrationStore(t)
	seedDonation(t, pool, 1)
	seedDonation(t, pool, 2)
	now := time.Date(2026, 9, 4, 12, 0, 0, 0, time.UTC)

	jobs := make(chan *Job, 2)
	errorsChannel := make(chan error, 2)
	var waitGroup sync.WaitGroup
	for range 2 {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			job, err := store.Claim(context.Background(), now, time.Minute)
			jobs <- job
			errorsChannel <- err
		}()
	}
	waitGroup.Wait()
	close(jobs)
	close(errorsChannel)
	for err := range errorsChannel {
		if err != nil {
			t.Fatal(err)
		}
	}
	claimed := map[int64]bool{}
	for job := range jobs {
		if job == nil {
			t.Fatal("expected both workers to claim work")
		}
		claimed[job.DonationID] = true
	}
	if len(claimed) != 2 {
		t.Fatalf("claimed donations = %#v", claimed)
	}
}

func TestLeaseExpiryReclaimsWithNewGeneration(t *testing.T) {
	store, pool := newIntegrationStore(t)
	seedDonation(t, pool, 1)
	now := time.Date(2026, 9, 4, 12, 0, 0, 0, time.UTC)
	first, err := store.Claim(context.Background(), now, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if job, err := store.Claim(context.Background(), now.Add(59*time.Second), time.Minute); err != nil || job != nil {
		t.Fatalf("claim before expiry = %#v, %v", job, err)
	}
	second, err := store.Claim(context.Background(), now.Add(time.Minute), time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if second == nil || second.Generation != first.Generation+1 || second.Attempts != 2 {
		t.Fatalf("reclaimed job = %#v after %#v", second, first)
	}
}

func TestStaleCompletionCannotFinishReclaimedWork(t *testing.T) {
	store, pool := newIntegrationStore(t)
	seedDonation(t, pool, 1)
	now := time.Date(2026, 9, 4, 12, 0, 0, 0, time.UTC)
	first, _ := store.Claim(context.Background(), now, time.Minute)
	second, _ := store.Claim(context.Background(), now.Add(time.Minute), time.Minute)
	if err := store.Complete(context.Background(), *first, nil, now.Add(time.Minute)); !errors.Is(err, ErrLeaseLost) {
		t.Fatalf("stale completion error = %v", err)
	}
	if err := store.Complete(context.Background(), *second, nil, now.Add(time.Minute+time.Second)); err != nil {
		t.Fatal(err)
	}
}

func TestCompletionIsIdempotentForDuplicateVideos(t *testing.T) {
	store, pool := newIntegrationStore(t)
	seedDonation(t, pool, 1)
	now := time.Date(2026, 9, 4, 12, 0, 0, 0, time.UTC)
	job, _ := store.Claim(context.Background(), now, time.Minute)
	video := Video{Title: "Video title", ProviderVideoID: "same", URL: "https://youtu.be/same", StartSeconds: 0, EndSeconds: intPointer(10), DurationSeconds: intPointer(10)}
	if err := store.Complete(context.Background(), *job, []Video{video, video}, now.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	var title string
	if err := pool.QueryRow(context.Background(), `SELECT title FROM video WHERE provider_video_id = 'same'`).Scan(&title); err != nil {
		t.Fatal(err)
	}
	if title != video.Title {
		t.Fatalf("title = %q", title)
	}
	var count int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM video WHERE donation_id = 1`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("video count=%d err=%v", count, err)
	}
}

func TestCompletionIsAllOrNothing(t *testing.T) {
	store, pool := newIntegrationStore(t)
	seedDonation(t, pool, 1)
	now := time.Date(2026, 9, 4, 12, 0, 0, 0, time.UTC)
	job, _ := store.Claim(context.Background(), now, time.Minute)
	videos := []Video{
		{ProviderVideoID: "valid", URL: "https://youtu.be/valid", StartSeconds: 0, EndSeconds: intPointer(10), DurationSeconds: intPointer(10)},
		{ProviderVideoID: "invalid", URL: "https://youtu.be/invalid", StartSeconds: 0, EndSeconds: intPointer(0), DurationSeconds: intPointer(10)},
	}
	if err := store.Complete(context.Background(), *job, videos, now.Add(time.Second)); err == nil {
		t.Fatal("expected invalid second insert to abort completion")
	}
	var videoCount int
	var parsed, completed bool
	err := pool.QueryRow(context.Background(), `
		SELECT
			(SELECT count(*) FROM video),
			(SELECT videos_parsed_at IS NOT NULL FROM donation WHERE donation_id = 1),
			(SELECT completed_at IS NOT NULL FROM donation_video_scan WHERE donation_id = 1)
	`).Scan(&videoCount, &parsed, &completed)
	if err != nil || videoCount != 0 || parsed || completed {
		t.Fatalf("count=%d parsed=%v completed=%v err=%v", videoCount, parsed, completed, err)
	}
}

func TestNoLinksCompletionSetsVideosParsedAt(t *testing.T) {
	store, pool := newIntegrationStore(t)
	seedDonation(t, pool, 1)
	now := time.Date(2026, 9, 4, 12, 0, 0, 0, time.UTC)
	worker := newWorker(store, &fakeClock{now: now}, DefaultConfig())
	if worked, err := worker.ProcessNext(context.Background()); err != nil || !worked {
		t.Fatalf("ProcessNext() = %v, %v", worked, err)
	}
	var parsed, completed bool
	err := pool.QueryRow(context.Background(), `
		SELECT donation.videos_parsed_at IS NOT NULL, donation_video_scan.completed_at IS NOT NULL
		FROM donation
		JOIN donation_video_scan USING (donation_id)
		WHERE donation_id = 1
	`).Scan(&parsed, &completed)
	if err != nil || !parsed || !completed {
		t.Fatalf("parsed=%v completed=%v err=%v", parsed, completed, err)
	}
}

func newIntegrationStore(t *testing.T) (*Store, *pgxpool.Pool) {
	t.Helper()
	databaseURL := os.Getenv("VIDEO_INGEST_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("VIDEO_INGEST_TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	schema := fmt.Sprintf("videoingest_test_%d_%d", os.Getpid(), testSchemaSequence.Add(1))
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		admin.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = admin.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
		admin.Close()
	})

	database, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	query := database.Query()
	query.Set("search_path", schema)
	database.RawQuery = query.Encode()

	repositoryRoot, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	command := exec.Command(filepath.Join(repositoryRoot, "node_modules", ".bin", "dbmate"), "--no-dump-schema", "up")
	command.Dir = repositoryRoot
	command.Env = append(os.Environ(), "DATABASE_URL="+database.String())
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("apply test migrations: %v\n%s", err, output)
	}

	config, err := pgxpool.ParseConfig(database.String())
	if err != nil {
		t.Fatal(err)
	}
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return NewStore(pool), pool
}

func seedDonation(t *testing.T, pool *pgxpool.Pool, donationID int64) {
	t.Helper()
	seedDonationWithoutScan(t, pool, donationID)
	if _, err := pool.Exec(context.Background(), `
        INSERT INTO donation_video_scan (donation_id, available_at)
        VALUES ($1, '2026-09-04T12:00:00Z')
        ON CONFLICT (donation_id) DO UPDATE SET available_at = EXCLUDED.available_at
    `, donationID); err != nil {
		t.Fatal(err)
	}
}

func seedDonationWithoutScan(t *testing.T, pool *pgxpool.Pool, donationID int64) {
	t.Helper()
	ctx := context.Background()
	_, err := pool.Exec(ctx, `INSERT INTO auth_user (id, name, email, "emailVerified") VALUES ('test', 'Test', 'test@example.com', true) ON CONFLICT DO NOTHING;
        INSERT INTO "user" (user_id, auth_user_id, queue_currency) VALUES (1, 'test', 'RUB') ON CONFLICT DO NOTHING;
        INSERT INTO video_queue (user_id, label, is_default)
        VALUES (1, 'Main', true) ON CONFLICT DO NOTHING;
        INSERT INTO video_priority (user_id, video_queue_id, label, min_price_per_minute, is_default)
        SELECT 1, video_queue_id, 'Default', 0, true FROM video_queue WHERE user_id = 1 AND is_default
        ON CONFLICT DO NOTHING`)
	if err == nil {
		_, err = pool.Exec(ctx, `INSERT INTO donation (donation_id, user_id, amount, currency, source, source_donation_id, source_created_at, occurred_at)
        OVERRIDING SYSTEM VALUE VALUES ($1, 1, 10, 'RUB', 'donationalerts', $1::bigint::text, 'test', now())`, donationID)
	}
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM donation_video_scan WHERE donation_id = $1`, donationID); err != nil {
		t.Fatal(err)
	}
}
