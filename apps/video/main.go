package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lebedev-nikita/coldbrew/internal/observability"
	"github.com/lebedev-nikita/coldbrew/internal/videoingest"
)

func main() {
	shutdownLogs := observability.ConfigureDefault("video")
	err := run()
	if err != nil {
		slog.Error("video service stopped", "error", err)
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	shutdownLogs(shutdownCtx)
	if err != nil {
		os.Exit(1)
	}
}

func run() error {
	backfillTitles := flag.Bool("backfill-titles", false, "Fill missing video titles and exit")
	flag.Parse()
	apiKey := strings.TrimSpace(os.Getenv("YOUTUBE_API_KEY"))
	if apiKey == "" {
		return errors.New("YOUTUBE_API_KEY is required")
	}
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
	if err := pool.Ping(ctx); err != nil {
		return fmt.Errorf("ping database: %w", err)
	}

	store := videoingest.NewStore(pool)
	httpClient := &http.Client{Timeout: 30 * time.Second}
	if *backfillTitles {
		return store.BackfillTitles(ctx, httpClient, apiKey)
	}
	worker := videoingest.NewWorker(store, videoingest.DefaultConfig())
	errors := make(chan error, 2)
	go func() { errors <- worker.Run(ctx) }()
	go func() { errors <- store.RunMetadata(ctx, httpClient, apiKey) }()
	firstErr := <-errors
	stop()
	secondErr := <-errors
	if firstErr != nil {
		return firstErr
	}
	return secondErr
}
