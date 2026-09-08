package videoingest

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"time"

	"github.com/lebedev-nikita/coldbrew/internal/money"
	"github.com/lebedev-nikita/coldbrew/internal/youtube"
)

type jobStore interface {
	Backfill(context.Context) error
	Claim(context.Context, time.Time, time.Duration) (*Job, error)
	Complete(context.Context, Job, []Video, time.Time) error
}

type clock interface {
	Now() time.Time
}

type Config struct {
	PollInterval  time.Duration
	LeaseDuration time.Duration
}

func DefaultConfig() Config {
	return Config{
		PollInterval:  2500 * time.Millisecond,
		LeaseDuration: 2 * time.Minute,
	}
}

type Worker struct {
	store  jobStore
	clock  clock
	config Config
}

func NewWorker(store *Store, config Config) *Worker {
	return newWorker(store, realClock{}, config)
}

func newWorker(store jobStore, workerClock clock, config Config) *Worker {
	return &Worker{store: store, clock: workerClock, config: config}
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
		parsed, _ := url.Parse(rawURL)
		var end *int
		if seconds, ok := youtube.ParseTimestamp(parsed.Query().Get("end")); ok && seconds > 0 {
			end = &seconds
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
			StartSeconds:    0,
			EndSeconds:      end,
		})
	}
	return videos, nil
}

type realClock struct{}

func (realClock) Now() time.Time { return time.Now() }
