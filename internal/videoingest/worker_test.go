package videoingest

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/lebedev-nikita/coldbrew/internal/youtube"
)

type fakeClock struct{ now time.Time }

func (clock *fakeClock) Now() time.Time { return clock.now }

type fakeStore struct {
	jobs          []Job
	completed     []Video
	retriedAt     time.Time
	retryError    string
	completeCalls int
	retryCalls    int
	completeErr   error
}

func (store *fakeStore) Backfill(context.Context) error { return nil }

func (store *fakeStore) Claim(context.Context, time.Time, time.Duration) (*Job, error) {
	if len(store.jobs) == 0 {
		return nil, nil
	}
	job := store.jobs[0]
	store.jobs = store.jobs[1:]
	return &job, nil
}

func (store *fakeStore) Complete(_ context.Context, _ Job, videos []Video, _ time.Time) error {
	store.completeCalls++
	if store.completeErr != nil {
		err := store.completeErr
		store.completeErr = nil
		return err
	}
	store.completed = append([]Video(nil), videos...)
	return nil
}

func (store *fakeStore) Retry(_ context.Context, _ Job, availableAt time.Time, safeError string, _ time.Time) error {
	store.retryCalls++
	store.retriedAt = availableAt
	store.retryError = safeError
	return nil
}

type fakeYouTube struct {
	timing youtube.Timing
	err    error
	calls  int
}

func (client *fakeYouTube) Timing(context.Context, string) (youtube.Timing, error) {
	client.calls++
	return client.timing, client.err
}

func TestNoLinksCompletesDonationAsParsed(t *testing.T) {
	now := time.Date(2026, 9, 4, 12, 0, 0, 0, time.UTC)
	store := &fakeStore{jobs: []Job{{DonationID: 1, Generation: 1, Attempts: 1, Amount: "10.00", Currency: "RUB", QueueCurrency: "RUB"}}}
	youtubeClient := &fakeYouTube{}
	worker := newWorker(store, youtubeClient, &fakeClock{now: now}, DefaultConfig())

	worked, err := worker.ProcessNext(context.Background())
	if err != nil || !worked {
		t.Fatalf("ProcessNext() = %v, %v", worked, err)
	}
	if store.completeCalls != 1 || len(store.completed) != 0 || youtubeClient.calls != 0 {
		t.Fatalf("complete calls=%d videos=%d youtube calls=%d", store.completeCalls, len(store.completed), youtubeClient.calls)
	}
}

func TestRateLimitSchedulesBoundedRetry(t *testing.T) {
	now := time.Date(2026, 9, 4, 12, 0, 0, 0, time.UTC)
	message := "https://youtu.be/dQw4w9WgXcQ"
	store := &fakeStore{jobs: []Job{{DonationID: 1, Generation: 1, Attempts: 20, Message: &message, Amount: "10.00", Currency: "RUB", QueueCurrency: "RUB"}}}
	youtubeClient := &fakeYouTube{err: &youtube.HTTPError{Status: http.StatusTooManyRequests, URL: message}}
	worker := newWorker(store, youtubeClient, &fakeClock{now: now}, DefaultConfig())

	if worked, err := worker.ProcessNext(context.Background()); err != nil || !worked {
		t.Fatalf("ProcessNext() = %v, %v", worked, err)
	}
	if store.retryCalls != 1 || store.completeCalls != 0 {
		t.Fatalf("retry calls=%d complete calls=%d", store.retryCalls, store.completeCalls)
	}
	if want := now.Add(5 * time.Minute); !store.retriedAt.Equal(want) {
		t.Fatalf("availableAt=%s want %s", store.retriedAt, want)
	}
	if store.retryError != "youtube rate limited" {
		t.Fatalf("persisted unsafe/unexpected error %q", store.retryError)
	}
}

func TestTransportFailureSchedulesRetry(t *testing.T) {
	now := time.Date(2026, 9, 4, 12, 0, 0, 0, time.UTC)
	message := "https://youtu.be/dQw4w9WgXcQ"
	store := &fakeStore{jobs: []Job{{DonationID: 1, Generation: 1, Attempts: 1, Message: &message, Amount: "10.00", Currency: "RUB", QueueCurrency: "RUB"}}}
	youtubeClient := &fakeYouTube{err: &youtube.TransportError{Err: errors.New("connection reset")}}
	worker := newWorker(store, youtubeClient, &fakeClock{now: now}, DefaultConfig())

	if worked, err := worker.ProcessNext(context.Background()); err != nil || !worked {
		t.Fatalf("ProcessNext() = %v, %v", worked, err)
	}
	if store.retryCalls != 1 || store.retryError != "youtube transport failure" {
		t.Fatalf("retry calls=%d error=%q", store.retryCalls, store.retryError)
	}
}

func TestInvalidLinkDoesNotBlockDonation(t *testing.T) {
	now := time.Date(2026, 9, 4, 12, 0, 0, 0, time.UTC)
	message := "https://youtu.be/not-available"
	store := &fakeStore{jobs: []Job{{DonationID: 1, Generation: 1, Attempts: 1, Message: &message, Amount: "10.00", Currency: "RUB", QueueCurrency: "RUB"}}}
	youtubeClient := &fakeYouTube{err: errors.New("youtube: duration not found")}
	worker := newWorker(store, youtubeClient, &fakeClock{now: now}, DefaultConfig())

	if worked, err := worker.ProcessNext(context.Background()); err != nil || !worked {
		t.Fatalf("ProcessNext() = %v, %v", worked, err)
	}
	if store.completeCalls != 1 || len(store.completed) != 0 || store.retryCalls != 0 {
		t.Fatalf("complete calls=%d videos=%d retry calls=%d", store.completeCalls, len(store.completed), store.retryCalls)
	}
}

func TestCrashLeavesWorkForLeaseRetry(t *testing.T) {
	now := time.Date(2026, 9, 4, 12, 0, 0, 0, time.UTC)
	job := Job{DonationID: 1, Generation: 1, Attempts: 1, Amount: "10.00", Currency: "RUB", QueueCurrency: "RUB"}
	store := &fakeStore{jobs: []Job{job, {DonationID: 1, Generation: 2, Attempts: 2, Amount: "10.00", Currency: "RUB", QueueCurrency: "RUB"}}, completeErr: errors.New("connection lost")}
	worker := newWorker(store, &fakeYouTube{}, &fakeClock{now: now}, DefaultConfig())

	if _, err := worker.ProcessNext(context.Background()); err == nil {
		t.Fatal("expected completion failure to simulate a crash")
	}
	if worked, err := worker.ProcessNext(context.Background()); err != nil || !worked {
		t.Fatalf("retry ProcessNext() = %v, %v", worked, err)
	}
	if store.completeCalls != 2 || store.retryCalls != 0 {
		t.Fatalf("complete calls=%d retry calls=%d", store.completeCalls, store.retryCalls)
	}
}

func TestCancellationIsNotPersistedAsFailure(t *testing.T) {
	now := time.Date(2026, 9, 4, 12, 0, 0, 0, time.UTC)
	message := "https://youtu.be/dQw4w9WgXcQ"
	store := &fakeStore{jobs: []Job{{DonationID: 1, Generation: 1, Attempts: 1, Message: &message, Amount: "10.00", Currency: "RUB", QueueCurrency: "RUB"}}}
	worker := newWorker(store, &fakeYouTube{err: context.Canceled}, &fakeClock{now: now}, DefaultConfig())
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	if worked, err := worker.ProcessNext(ctx); err != nil || !worked {
		t.Fatalf("ProcessNext() = %v, %v", worked, err)
	}
	if store.retryCalls != 0 || store.completeCalls != 0 {
		t.Fatalf("retry calls=%d complete calls=%d", store.retryCalls, store.completeCalls)
	}
}
