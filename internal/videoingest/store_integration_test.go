package videoingest

import (
	"context"
	"errors"
	"fmt"
	"os"
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
	video := Video{ProviderVideoID: "same", URL: "https://youtu.be/same", StartSeconds: 0, EndSeconds: 10, DurationSeconds: 10}
	if err := store.Complete(context.Background(), *job, []Video{video, video}, now.Add(time.Second)); err != nil {
		t.Fatal(err)
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
		{ProviderVideoID: "valid", URL: "https://youtu.be/valid", StartSeconds: 0, EndSeconds: 10, DurationSeconds: 10},
		{ProviderVideoID: "invalid", URL: "https://youtu.be/invalid", StartSeconds: 0, EndSeconds: 0, DurationSeconds: 10},
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
	worker := newWorker(store, &fakeYouTube{}, &fakeClock{now: now}, DefaultConfig())
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

	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	_, err = pool.Exec(ctx, `
		CREATE TABLE "user" (
			user_id integer PRIMARY KEY,
			queue_currency char(3) NOT NULL
		);
		CREATE TABLE donation (
			donation_id bigint PRIMARY KEY,
			user_id integer NOT NULL REFERENCES "user" (user_id),
			message text NULL,
			amount numeric(20, 2) NOT NULL,
			currency char(3) NOT NULL,
			videos_parsed_at timestamptz NULL
		);
		CREATE TABLE donation_video_scan (
			donation_id bigint PRIMARY KEY REFERENCES donation (donation_id),
			generation bigint NOT NULL DEFAULT 0,
			attempts integer NOT NULL DEFAULT 0,
			available_at timestamptz NOT NULL DEFAULT now(),
			lease_expires_at timestamptz NULL,
			completed_at timestamptz NULL,
			last_error text NULL
		);
		CREATE TABLE video (
			video_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
			donation_id bigint REFERENCES donation (donation_id),
			provider text NOT NULL,
			provider_video_id text NOT NULL,
			url text NOT NULL,
			queue_amount numeric(20, 2) NULL,
			start_seconds integer NOT NULL CHECK (start_seconds >= 0),
			end_seconds integer NOT NULL CHECK (end_seconds > 0),
			duration_seconds integer NOT NULL CHECK (duration_seconds > 0),
			UNIQUE (donation_id, provider, provider_video_id),
			CHECK (end_seconds > start_seconds)
		)
	`)
	if err != nil {
		t.Fatal(err)
	}
	return NewStore(pool), pool
}

func seedDonation(t *testing.T, pool *pgxpool.Pool, donationID int64) {
	t.Helper()
	seedDonationWithoutScan(t, pool, donationID)
	if _, err := pool.Exec(context.Background(), `INSERT INTO donation_video_scan (donation_id) VALUES ($1)`, donationID); err != nil {
		t.Fatal(err)
	}
}

func seedDonationWithoutScan(t *testing.T, pool *pgxpool.Pool, donationID int64) {
	t.Helper()
	ctx := context.Background()
	_, err := pool.Exec(ctx, `INSERT INTO "user" (user_id, queue_currency) VALUES (1, 'RUB') ON CONFLICT DO NOTHING`)
	if err == nil {
		_, err = pool.Exec(ctx, `INSERT INTO donation (donation_id, user_id, amount, currency) VALUES ($1, 1, 10, 'RUB')`, donationID)
	}
	if err != nil {
		t.Fatal(err)
	}
}
