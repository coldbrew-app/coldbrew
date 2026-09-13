package donationalert

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

type workerTestStore struct {
	preparation *Preparation
	complete    func(Preparation, Media)
	fail        func(Preparation, string)
}

func (store *workerTestStore) ClaimPreparation(context.Context, time.Time) (*Preparation, error) {
	preparation := store.preparation
	store.preparation = nil
	return preparation, nil
}

func (store *workerTestStore) CompletePreparation(_ context.Context, preparation Preparation, media Media, _ time.Time) error {
	store.complete(preparation, media)
	return nil
}

func (store *workerTestStore) FailPreparation(_ context.Context, preparation Preparation, detail string, _ time.Time) error {
	store.fail(preparation, detail)
	return nil
}

type workerTestSynthesizer struct {
	media Media
	err   error
}

type retentionWorkerTestStore struct{ calls chan time.Time }

func (store *retentionWorkerTestStore) PruneRetention(_ context.Context, now time.Time) error {
	store.calls <- now
	return nil
}

func (synthesizer workerTestSynthesizer) Synthesize(context.Context, string, string) (Media, error) {
	return synthesizer.media, synthesizer.err
}

func TestWorkerCompletesClaimedPreparation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	media := Media{MIMEType: "audio/ogg", Content: []byte("sound"), DurationMS: 500}
	store := &workerTestStore{preparation: &Preparation{PlaybackID: "playback", Text: "hello", Voice: "ru"}}
	store.complete = func(preparation Preparation, received Media) {
		if preparation.PlaybackID != "playback" || string(received.Content) != "sound" {
			t.Errorf("complete preparation = %#v media=%#v", preparation, received)
		}
		cancel()
	}
	store.fail = func(Preparation, string) { t.Error("unexpected failure") }
	worker := newWorker(store, workerTestSynthesizer{media: media})
	worker.idleDelay = time.Millisecond
	if err := worker.Run(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestWorkerStoresSafeSynthesisDiagnostic(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	store := &workerTestStore{preparation: &Preparation{PlaybackID: "playback", Attempts: PreparationTries, Text: "hello", Voice: "ru"}}
	store.complete = func(Preparation, Media) { t.Error("unexpected completion") }
	store.fail = func(_ Preparation, detail string) {
		if strings.Contains(detail, "private process detail") || detail == "" {
			t.Errorf("unsafe detail = %q", detail)
		}
		cancel()
	}
	worker := newWorker(store, workerTestSynthesizer{err: &SynthesisError{Code: SynthesisFailed, Err: errors.New("private process detail")}})
	worker.idleDelay = time.Millisecond
	if err := worker.Run(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestRetentionWorkerSweepsImmediately(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	store := &retentionWorkerTestStore{calls: make(chan time.Time, 1)}
	now := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	worker := newRetentionWorker(store)
	worker.now = func() time.Time { return now }
	worker.interval = time.Hour
	done := make(chan error, 1)
	go func() { done <- worker.Run(ctx) }()

	select {
	case calledAt := <-store.calls:
		if !calledAt.Equal(now) {
			t.Fatalf("sweep time = %v, want %v", calledAt, now)
		}
	case <-time.After(time.Second):
		t.Fatal("retention worker did not sweep immediately")
	}
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("retention worker did not stop")
	}
}
