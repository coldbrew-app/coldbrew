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

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lebedev-nikita/coldbrew/internal/videoingest"
)

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
	if err := pool.Ping(ctx); err != nil {
		return fmt.Errorf("ping database: %w", err)
	}

	store := videoingest.NewStore(pool)
	youtubeClient := videoingest.NewYouTubeClient(&http.Client{Timeout: 30 * time.Second})
	worker := videoingest.NewWorker(store, youtubeClient, videoingest.DefaultConfig())
	return worker.Run(ctx)
}
