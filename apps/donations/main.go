package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lebedev-nikita/coldbrew/internal/donatestream"
	"github.com/lebedev-nikita/coldbrew/internal/donationalerts"
	"github.com/lebedev-nikita/coldbrew/internal/donations"
	"github.com/lebedev-nikita/coldbrew/internal/observability"
	"github.com/lebedev-nikita/coldbrew/internal/streamlabs"
)

func main() {
	shutdownLogs := observability.ConfigureDefault("donations")
	err := run()
	if err != nil {
		slog.Error("Donations service stopped", "error", err)
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	shutdownLogs(shutdownCtx)
	if err != nil {
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
	store := donations.NewStore(pool)
	donationAlertsClient := donationalerts.NewClient(httpClient)
	donationAlertsProvider := donations.NewDonationAlertsAdapter(
		donationAlertsClient,
		donationalerts.NewSource(donationAlertsClient),
		donationalerts.Config{ClientID: config.donationAlertsClientID, ClientSecret: config.donationAlertsClientSecret},
	)
	streamlabsClient := streamlabs.NewClient(httpClient)
	streamlabsProvider := donations.NewStreamlabsAdapter(
		streamlabsClient,
		streamlabs.NewSource(streamlabsClient),
		streamlabs.Config{
			ClientID:     config.streamlabsClientID,
			ClientSecret: config.streamlabsClientSecret,
			RedirectURI:  config.streamlabsRedirectURI,
		},
	)
	oauthApplication := donations.NewApplication(
		store,
		donationAlertsProvider,
		streamlabsProvider,
	)
	donateStreamApplication := donations.NewDonateStreamApplication(store, donatestream.NewSource())
	server := &http.Server{
		Addr:              ":" + strconv.Itoa(config.port),
		Handler:           donations.NewHTTPHandler(oauthApplication, donateStreamApplication, config.serviceSecret),
		ReadHeaderTimeout: 10 * time.Second,
	}
	workerErrors := make(chan error, 2)
	go func() { workerErrors <- oauthApplication.Run(ctx) }()
	go func() { workerErrors <- donateStreamApplication.Run(ctx) }()
	serverErrors := make(chan error, 1)
	go func() {
		slog.Info("Donations service listening", "address", server.Addr)
		serverErrors <- server.ListenAndServe()
	}()

	var runErr error
	workersFinished := 0
	select {
	case <-ctx.Done():
	case err := <-workerErrors:
		workersFinished++
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
	for workersFinished < 2 {
		if err := <-workerErrors; err != nil {
			runErr = errors.Join(runErr, fmt.Errorf("stop donation integration worker: %w", err))
		}
		workersFinished++
	}
	return errors.Join(runErr, shutdownErr)
}

type serviceConfig struct {
	databaseURL                string
	donationAlertsClientID     string
	donationAlertsClientSecret string
	streamlabsClientID         string
	streamlabsClientSecret     string
	streamlabsRedirectURI      string
	serviceSecret              string
	port                       int
}

func loadConfig() (serviceConfig, error) {
	streamlabsRedirectURI, err := streamlabsCallbackURL(os.Getenv("APP_DOMAIN"))
	if err != nil {
		return serviceConfig{}, err
	}
	config := serviceConfig{
		databaseURL:                os.Getenv("DATABASE_URL"),
		donationAlertsClientID:     os.Getenv("DONATION_ALERTS_CLIENT_ID"),
		donationAlertsClientSecret: os.Getenv("DONATION_ALERTS_CLIENT_SECRET"),
		streamlabsClientID:         os.Getenv("STREAMLABS_CLIENT_ID"),
		streamlabsClientSecret:     os.Getenv("STREAMLABS_CLIENT_SECRET"),
		streamlabsRedirectURI:      streamlabsRedirectURI,
		serviceSecret:              os.Getenv("DONATIONS_SERVICE_SECRET"),
		port:                       3002,
	}
	if config.databaseURL == "" || config.donationAlertsClientID == "" || config.donationAlertsClientSecret == "" || config.streamlabsClientID == "" || config.streamlabsClientSecret == "" {
		return serviceConfig{}, errors.New("DATABASE_URL and DonationAlerts and Streamlabs client credentials are required")
	}
	if _, err := strconv.ParseUint(config.donationAlertsClientID, 10, 64); err != nil {
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

func streamlabsCallbackURL(appDomain string) (string, error) {
	parsed, err := url.Parse(appDomain)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return "", errors.New("APP_DOMAIN must be an absolute HTTP(S) URL")
	}
	parsed.Path = "/api/integration/streamlabs/callback"
	parsed.RawPath = ""
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String(), nil
}
