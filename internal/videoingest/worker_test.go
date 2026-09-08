package videoingest

import (
	"context"
	"testing"
	"time"
)

type fakeClock struct{ now time.Time }

func (clock *fakeClock) Now() time.Time { return clock.now }

type fakeStore struct {
	jobs          []Job
	completed     []Video
	completeCalls int
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
		return store.completeErr
	}
	store.completed = videos
	return nil
}
func TestScanPersistsLinksWithoutMetadata(t *testing.T) {
	for _, test := range []struct {
		message string
		count   int
	}{
		{"no links", 0},
		{"Посмотри видео, пожалуйста: https://www.youtube.com/watch?v=_JXL6Fn99l8&t=13s", 1},
		{"https://www.youtube.com/watch?v=_JXL6Fn99l8&end=60", 1},
	} {
		t.Run(test.message, func(t *testing.T) {
			store := &fakeStore{jobs: []Job{{DonationID: 1101, Message: &test.message, Amount: "10.00", Currency: "RUB", QueueCurrency: "RUB"}}}
			worked, err := newWorker(store, &fakeClock{time.Now()}, DefaultConfig()).ProcessNext(context.Background())
			if err != nil || !worked || store.completeCalls != 1 || len(store.completed) != test.count {
				t.Fatalf("worked=%v err=%v completed=%+v", worked, err, store.completed)
			}
			for _, video := range store.completed {
				if video.ProviderVideoID != "_JXL6Fn99l8" || video.DurationSeconds != nil || video.QueueAmount == nil {
					t.Fatalf("unexpected video: %+v", video)
				}
			}
		})
	}
}
func TestMetadataRetrySchedule(t *testing.T) {
	for attempt, want := range []time.Duration{15 * time.Second, time.Minute, 5 * time.Minute, 15 * time.Minute, time.Hour, 6 * time.Hour, 24 * time.Hour, 24 * time.Hour} {
		if got := metadataDelay(attempt + 1); got != want {
			t.Fatalf("attempt %d: %s != %s", attempt+1, got, want)
		}
	}
}
func intPointer(value int) *int { return &value }
