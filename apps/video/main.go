package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lebedev-nikita/coldbrew/internal/money"
	"github.com/lebedev-nikita/coldbrew/internal/youtube"
)

const pollInterval = 2500 * time.Millisecond

type donation struct {
	DonationID    int64
	Message       *string
	Amount        string
	Currency      string
	QueueCurrency string
}

type videoToSave struct {
	ProviderVideoID string
	URL             string
	QueueAmount     *string
	Timing          youtube.Timing
}

type store struct {
	pool *pgxpool.Pool
}

func main() {
	if err := run(); err != nil {
		slog.Error("video service stopped", "error", err)
		os.Exit(1)
	}
}

func run() error {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		return errors.New("DATABASE_URL is required")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return fmt.Errorf("connect to database: %w", err)
	}
	defer pool.Close()

	serviceStore := &store{pool: pool}
	client := &http.Client{Timeout: 30 * time.Second}
	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			if err := processBatch(ctx, serviceStore, client); err != nil {
				return err
			}
		}
	}
}

func processBatch(ctx context.Context, serviceStore *store, client *http.Client) error {
	donations, err := serviceStore.getUnparsedDonations(ctx, 100)
	if err != nil {
		return fmt.Errorf("get unparsed donations: %w", err)
	}
	for _, currentDonation := range donations {
		videos := make([]videoToSave, 0)
		retryDonation := false
		message := ""
		if currentDonation.Message != nil {
			message = *currentDonation.Message
		}
		for _, rawURL := range youtube.ExtractURLs(message) {
			timing, timingErr := youtube.GetTiming(ctx, client, rawURL, nil)
			if timingErr != nil {
				slog.Warn("skip video URL", "url", rawURL, "error", timingErr)
				var httpError *youtube.HTTPError
				if errors.As(timingErr, &httpError) && httpError.Status == http.StatusTooManyRequests {
					retryDonation = true
					break
				}
				continue
			}
			providerVideoID, ok := youtube.VideoID(rawURL)
			if !ok {
				continue
			}
			var queueAmount *string
			converted, supported, convertErr := money.ConvertWithDefaultRate(currentDonation.Amount, currentDonation.Currency, currentDonation.QueueCurrency)
			if convertErr != nil {
				return fmt.Errorf("convert donation %d amount: %w", currentDonation.DonationID, convertErr)
			}
			if supported {
				queueAmount = &converted
			}
			videos = append(videos, videoToSave{ProviderVideoID: providerVideoID, URL: rawURL, QueueAmount: queueAmount, Timing: timing})
		}
		if retryDonation {
			continue
		}
		if err := serviceStore.setDonationParsed(ctx, currentDonation.DonationID, videos); err != nil {
			return fmt.Errorf("mark donation %d parsed: %w", currentDonation.DonationID, err)
		}
	}
	return nil
}

func (serviceStore *store) getUnparsedDonations(ctx context.Context, limit int) ([]donation, error) {
	rows, err := serviceStore.pool.Query(ctx, `
		SELECT donation_id, message, amount::text, currency::text, "user".queue_currency::text
		FROM donation
		JOIN "user" USING (user_id)
		WHERE videos_parsed_at IS NULL
		ORDER BY occurred_at ASC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	donations := make([]donation, 0)
	for rows.Next() {
		var item donation
		if err := rows.Scan(&item.DonationID, &item.Message, &item.Amount, &item.Currency, &item.QueueCurrency); err != nil {
			return nil, err
		}
		donations = append(donations, item)
	}
	return donations, rows.Err()
}

func (serviceStore *store) setDonationParsed(ctx context.Context, donationID int64, videos []videoToSave) error {
	return pgx.BeginFunc(ctx, serviceStore.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE donation SET videos_parsed_at = now() WHERE donation_id = $1`, donationID); err != nil {
			return err
		}
		for _, video := range videos {
			if _, err := tx.Exec(ctx, `
				INSERT INTO video (
					donation_id,
					provider,
					provider_video_id,
					url,
					queue_amount,
					start_seconds,
					end_seconds,
					duration_seconds
				)
				VALUES ($1, 'youtube', $2, $3, $4, $5, $6, $7)
				ON CONFLICT (donation_id, provider, provider_video_id) DO NOTHING
			`, donationID, video.ProviderVideoID, video.URL, video.QueueAmount, video.Timing.StartSeconds, video.Timing.EndSeconds, video.Timing.DurationSeconds); err != nil {
				return err
			}
		}
		return nil
	})
}
