package videoingest

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/lebedev-nikita/coldbrew/internal/money"
	"github.com/lebedev-nikita/coldbrew/internal/youtube"
)

type jobStore interface {
	Backfill(context.Context) error
	Claim(context.Context, time.Time, time.Duration) (*Job, error)
	Complete(context.Context, Job, []Video, time.Time) error
	Retry(context.Context, Job, time.Time, string, time.Time) error
}

type youtubeWork interface {
	Timing(context.Context, string) (youtube.Timing, error)
}

type clock interface {
	Now() time.Time
}

type Config struct {
	PollInterval  time.Duration
	LeaseDuration time.Duration
	BaseBackoff   time.Duration
	MaxBackoff    time.Duration
}

func DefaultConfig() Config {
	return Config{
		PollInterval:  2500 * time.Millisecond,
		LeaseDuration: 2 * time.Minute,
		BaseBackoff:   5 * time.Second,
		MaxBackoff:    5 * time.Minute,
	}
}

type Worker struct {
	store   jobStore
	youtube youtubeWork
	clock   clock
	config  Config
}

func NewWorker(store *Store, youtubeClient *YouTubeClient, config Config) *Worker {
	return newWorker(store, youtubeClient, realClock{}, config)
}

func newWorker(store jobStore, youtubeClient youtubeWork, workerClock clock, config Config) *Worker {
	return &Worker{store: store, youtube: youtubeClient, clock: workerClock, config: config}
}

func (worker *Worker) Run(ctx context.Context) error {
	if err := worker.store.Backfill(ctx); err != nil {
		if ctx.Err() != nil {
			return nil
		}
		return fmt.Errorf("backfill donation video scans: %w", err)
	}
	for {
		worked, err := worker.ProcessNext(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return err
		}
		if worked {
			continue
		}
		timer := time.NewTimer(worker.config.PollInterval)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				<-timer.C
			}
			return nil
		case <-timer.C:
		}
	}
}

func (worker *Worker) ProcessNext(ctx context.Context) (bool, error) {
	now := worker.clock.Now()
	job, err := worker.store.Claim(ctx, now, worker.config.LeaseDuration)
	if err != nil {
		return false, fmt.Errorf("claim donation video scan: %w", err)
	}
	if job == nil {
		return false, nil
	}

	videos, err := worker.scan(ctx, *job)
	if err != nil {
		if (errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)) && ctx.Err() != nil {
			return true, nil
		}
		if retryableYouTubeError(err) {
			now = worker.clock.Now()
			if retryErr := worker.store.Retry(ctx, *job, now.Add(worker.backoff(job.Attempts)), safeYouTubeError(err), now); retryErr != nil && !errors.Is(retryErr, ErrLeaseLost) {
				return true, fmt.Errorf("retry donation video scan %d: %w", job.DonationID, retryErr)
			}
			return true, nil
		}
		return true, fmt.Errorf("scan donation %d: %w", job.DonationID, err)
	}

	if err := worker.store.Complete(ctx, *job, videos, worker.clock.Now()); err != nil {
		if errors.Is(err, ErrLeaseLost) {
			return true, nil
		}
		return true, fmt.Errorf("complete donation video scan %d: %w", job.DonationID, err)
	}
	return true, nil
}

func (worker *Worker) scan(ctx context.Context, job Job) ([]Video, error) {
	message := ""
	if job.Message != nil {
		message = *job.Message
	}
	queueAmount, supported, err := money.ConvertWithDefaultRate(job.Amount, job.Currency, job.QueueCurrency)
	if err != nil {
		return nil, fmt.Errorf("convert donation amount: %w", err)
	}
	videos := make([]Video, 0)
	for _, rawURL := range youtube.ExtractURLs(message) {
		providerVideoID, ok := youtube.VideoID(rawURL)
		if !ok {
			continue
		}
		timing, timingErr := worker.youtube.Timing(ctx, rawURL)
		if timingErr != nil {
			if retryableYouTubeError(timingErr) || errors.Is(timingErr, context.Canceled) || errors.Is(timingErr, context.DeadlineExceeded) {
				return nil, timingErr
			}
			slog.Warn("skip unsupported or invalid video link", "donation_id", job.DonationID, "url", rawURL, "error", timingErr)
			continue
		}
		var amount *string
		if supported {
			value := queueAmount
			amount = &value
		}
		videos = append(videos, Video{
			ProviderVideoID: providerVideoID,
			URL:             rawURL,
			QueueAmount:     amount,
			StartSeconds:    timing.StartSeconds,
			EndSeconds:      timing.EndSeconds,
			DurationSeconds: timing.DurationSeconds,
		})
	}
	return videos, nil
}

func (worker *Worker) backoff(attempts int) time.Duration {
	delay := worker.config.BaseBackoff
	for attempt := 1; attempt < attempts && delay < worker.config.MaxBackoff; attempt++ {
		if delay > worker.config.MaxBackoff/2 {
			return worker.config.MaxBackoff
		}
		delay *= 2
	}
	if delay > worker.config.MaxBackoff {
		return worker.config.MaxBackoff
	}
	return delay
}

func retryableYouTubeError(err error) bool {
	var httpError *youtube.HTTPError
	if errors.As(err, &httpError) {
		return httpError.Status == http.StatusTooManyRequests
	}
	var transportError *youtube.TransportError
	return errors.As(err, &transportError)
}

func safeYouTubeError(err error) string {
	var httpError *youtube.HTTPError
	if errors.As(err, &httpError) && httpError.Status == http.StatusTooManyRequests {
		return "youtube rate limited"
	}
	return "youtube transport failure"
}

type realClock struct{}

func (realClock) Now() time.Time { return time.Now() }
