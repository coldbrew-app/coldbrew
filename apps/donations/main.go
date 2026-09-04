package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lebedev-nikita/coldbrew/internal/donationalerts"
	"github.com/lebedev-nikita/coldbrew/internal/donations"
)

func main() {
	if err := run(); err != nil {
		slog.Error("Donations service stopped", "error", err)
		os.Exit(1)
	}
}

func run() error {
	config, err := loadConfig()
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	pool, err := pgxpool.New(ctx, config.databaseURL)
	if err != nil {
		return fmt.Errorf("connect PostgreSQL: %w", err)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		return fmt.Errorf("ping PostgreSQL: %w", err)
	}

	httpClient := &http.Client{Timeout: 30 * time.Second}
	client := donationalerts.NewClient(httpClient)
	provider := donations.NewDonationAlertsAdapter(client, donationalerts.NewSource(client))
	application := donations.NewApplication(
		donations.NewStore(pool),
		provider,
		donationalerts.Config{ClientID: config.clientID, ClientSecret: config.clientSecret},
	)
	server := &http.Server{
		Addr:              ":" + strconv.Itoa(config.port),
		Handler:           donations.NewHTTPHandler(application, config.serviceSecret),
		ReadHeaderTimeout: 10 * time.Second,
	}
	workerErrors := make(chan error, 1)
	go func() { workerErrors <- application.Run(ctx) }()
	serverErrors := make(chan error, 1)
	go func() {
		slog.Info("Donations service listening", "address", server.Addr)
		serverErrors <- server.ListenAndServe()
	}()

	var runErr error
	workerFinished := false
	select {
	case <-ctx.Done():
	case err := <-workerErrors:
		workerFinished = true
		if err != nil {
			runErr = fmt.Errorf("run donation integration worker: %w", err)
		}
	case err := <-serverErrors:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			runErr = fmt.Errorf("serve donations HTTP: %w", err)
		}
	}
	stop()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var shutdownErr error
	if err := server.Shutdown(shutdownCtx); err != nil {
		shutdownErr = fmt.Errorf("shutdown donations HTTP: %w", err)
	}
	if !workerFinished {
		if err := <-workerErrors; err != nil {
			runErr = errors.Join(runErr, fmt.Errorf("stop donation integration worker: %w", err))
		}
	}
	return errors.Join(runErr, shutdownErr)
}

type serviceConfig struct {
	databaseURL   string
	clientID      string
	clientSecret  string
	serviceSecret string
	port          int
}

func loadConfig() (serviceConfig, error) {
	config := serviceConfig{
		databaseURL:   os.Getenv("DATABASE_URL"),
		clientID:      os.Getenv("DONATION_ALERTS_CLIENT_ID"),
		clientSecret:  os.Getenv("DONATION_ALERTS_CLIENT_SECRET"),
		serviceSecret: os.Getenv("DONATIONS_SERVICE_SECRET"),
		port:          3002,
	}
	if config.databaseURL == "" || config.clientID == "" || config.clientSecret == "" {
		return serviceConfig{}, errors.New("DATABASE_URL, DONATION_ALERTS_CLIENT_ID, and DONATION_ALERTS_CLIENT_SECRET are required")
	}
	if _, err := strconv.ParseUint(config.clientID, 10, 64); err != nil {
		return serviceConfig{}, errors.New("DONATION_ALERTS_CLIENT_ID must be numeric")
	}
	if len(config.serviceSecret) < 32 {
		return serviceConfig{}, errors.New("DONATIONS_SERVICE_SECRET must contain at least 32 characters")
	}
	if rawPort := os.Getenv("DONATIONS_PORT"); rawPort != "" {
		port, err := strconv.Atoi(rawPort)
		if err != nil || port <= 0 || port > 65535 {
			return serviceConfig{}, errors.New("DONATIONS_PORT must be a valid port")
		}
		config.port = port
	}
	return config, nil
}
