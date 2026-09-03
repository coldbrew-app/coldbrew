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
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lebedev-nikita/coldbrew/internal/chat"
)

func main() {
	if err := run(); err != nil {
		slog.Error("Chat service stopped", "error", err)
		os.Exit(1)
	}
}

func run() error {
	config, err := loadConfig()
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	pool, err := pgxpool.New(ctx, config.databaseURL)
	if err != nil {
		return fmt.Errorf("connect PostgreSQL: %w", err)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		return fmt.Errorf("ping PostgreSQL: %w", err)
	}
	natsConnection, err := chat.ConnectNats(config.natsServers)
	if err != nil {
		return fmt.Errorf("connect NATS: %w", err)
	}
	defer natsConnection.Close()

	tokenCipher, err := chat.NewTokenCipher(config.tokenEncryptionSecret)
	if err != nil {
		return fmt.Errorf("configure chat token encryption: %w", err)
	}
	store := chat.NewStore(pool, tokenCipher)
	httpClient := &http.Client{Timeout: 30 * time.Second}
	oauthConfigs := chat.OauthConfigs(config.youtube, config.twitch, config.kick)
	oauth := chat.NewOauth(store, config.publicURL, oauthConfigs, httpClient)
	baseProviders := []chat.Provider{chat.NewYoutubeProvider(httpClient)}
	if config.twitch != nil {
		baseProviders = append(baseProviders, chat.NewTwitchProvider(config.twitch[0], config.twitch[1], httpClient))
	}
	if config.kick != nil {
		baseProviders = append(baseProviders, chat.NewKickProvider(httpClient))
	}
	refresher := chat.NewTokenRefresher(store, chat.TokenRefreshConfigs(config.youtube, config.twitch, config.kick), httpClient)
	providers := make([]chat.Provider, 0, len(baseProviders))
	for _, provider := range baseProviders {
		providers = append(providers, chat.NewRefreshingProvider(provider, refresher))
	}
	application := chat.NewApplication(store, natsConnection.Broker, providers, natsConnection.CollectorControl)

	var kickWebhook *chat.KickWebhookHandler
	if config.kickWebhookPublicKey != "" {
		kickWebhook, err = chat.NewKickWebhookHandler(config.kickWebhookPublicKey, store, natsConnection.Broker)
		if err != nil {
			return fmt.Errorf("configure Kick webhook: %w", err)
		}
	}
	handler := chat.NewHTTPHandler(application, oauth, store, config.serviceSecret, config.webURL, kickWebhook)
	server := &http.Server{Addr: ":" + strconv.Itoa(config.port), Handler: handler, ReadHeaderTimeout: 10 * time.Second}
	collectorErrors := make(chan error, 1)
	go func() {
		collectorErrors <- chat.RunCollectors(ctx, store, natsConnection.Broker, natsConnection.Leases, natsConnection.CollectorControl, providers)
	}()
	serverErrors := make(chan error, 1)
	go func() {
		slog.Info("Chat service listening", "address", server.Addr)
		serverErrors <- server.ListenAndServe()
	}()

	select {
	case <-ctx.Done():
	case err := <-collectorErrors:
		if err != nil {
			stop()
			return fmt.Errorf("run chat collectors: %w", err)
		}
	case err := <-serverErrors:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			stop()
			return fmt.Errorf("serve chat HTTP: %w", err)
		}
	}
	stop()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("shutdown chat HTTP: %w", err)
	}
	return nil
}

type serviceConfig struct {
	databaseURL           string
	natsServers           string
	port                  int
	publicURL             string
	webURL                string
	serviceSecret         string
	tokenEncryptionSecret string
	youtube               *[2]string
	twitch                *[2]string
	kick                  *[2]string
	kickWebhookPublicKey  string
}

func loadConfig() (serviceConfig, error) {
	databaseURL, err := requiredEnvironment("DATABASE_URL")
	if err != nil {
		return serviceConfig{}, err
	}
	port := 3001
	if rawPort := os.Getenv("CHAT_PORT"); rawPort != "" {
		port, err = strconv.Atoi(rawPort)
		if err != nil || port <= 0 || port > 65535 {
			return serviceConfig{}, errors.New("CHAT_PORT must be a valid port")
		}
	}
	appDomain := os.Getenv("APP_DOMAIN")
	publicURL := os.Getenv("CHAT_PUBLIC_URL")
	if publicURL == "" && appDomain != "" {
		publicURL = strings.TrimSuffix(appDomain, "/") + "/api/chat"
	}
	webURL := os.Getenv("CHAT_WEB_URL")
	if webURL == "" {
		webURL = appDomain
	}
	if err := requireHTTPURL(publicURL, "CHAT_PUBLIC_URL or APP_DOMAIN"); err != nil {
		return serviceConfig{}, err
	}
	if err := requireHTTPURL(webURL, "CHAT_WEB_URL or APP_DOMAIN"); err != nil {
		return serviceConfig{}, err
	}
	serviceSecret := os.Getenv("CHAT_SERVICE_SECRET")
	if len(serviceSecret) < 32 {
		return serviceConfig{}, errors.New("CHAT_SERVICE_SECRET must contain at least 32 characters")
	}
	tokenSecret := os.Getenv("CHAT_TOKEN_ENCRYPTION_SECRET")
	if tokenSecret == "" {
		tokenSecret = os.Getenv("BETTER_AUTH_SECRET")
	}
	if len(tokenSecret) < 32 {
		return serviceConfig{}, errors.New("CHAT_TOKEN_ENCRYPTION_SECRET or BETTER_AUTH_SECRET must contain at least 32 characters")
	}
	youtube, err := configuredPair("YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET")
	if err != nil {
		return serviceConfig{}, err
	}
	twitch, err := configuredPair("TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET")
	if err != nil {
		return serviceConfig{}, err
	}
	kick, err := configuredPair("KICK_CLIENT_ID", "KICK_CLIENT_SECRET")
	if err != nil {
		return serviceConfig{}, err
	}
	if os.Getenv("KICK_WEBHOOK_PUBLIC_KEY") == "" {
		kick = nil
	}
	natsServers := os.Getenv("NATS_SERVERS")
	if natsServers == "" {
		natsServers = "nats://localhost:4222"
	}
	return serviceConfig{databaseURL: databaseURL, natsServers: natsServers, port: port, publicURL: publicURL, webURL: webURL, serviceSecret: serviceSecret, tokenEncryptionSecret: tokenSecret, youtube: youtube, twitch: twitch, kick: kick, kickWebhookPublicKey: os.Getenv("KICK_WEBHOOK_PUBLIC_KEY")}, nil
}

func requiredEnvironment(name string) (string, error) {
	value := os.Getenv(name)
	if value == "" {
		return "", fmt.Errorf("%s is required", name)
	}
	return value, nil
}

func configuredPair(clientIDName, clientSecretName string) (*[2]string, error) {
	clientID, clientSecret := os.Getenv(clientIDName), os.Getenv(clientSecretName)
	if clientID == "" && clientSecret == "" {
		return nil, nil
	}
	if clientID == "" || clientSecret == "" {
		return nil, fmt.Errorf("%s and %s must be configured together", clientIDName, clientSecretName)
	}
	return &[2]string{clientID, clientSecret}, nil
}

func requireHTTPURL(value, name string) error {
	parsed, err := url.Parse(value)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return fmt.Errorf("%s must be an HTTP URL", name)
	}
	return nil
}
