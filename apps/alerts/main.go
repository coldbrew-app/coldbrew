package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/lebedev-nikita/coldbrew/internal/alerts"
	"github.com/lebedev-nikita/coldbrew/internal/observability"
	"github.com/nats-io/nats.go"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	if err := run(); err != nil {
		slog.Error("Alerts service stopped", "error", err)
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
	telegram := alerts.NewTelegram(config.telegramToken, config.telegramAdminChatID, &http.Client{Timeout: 40 * time.Second})
	if config.telegramAdminChatID == "" {
		slog.Info("Telegram notifications disabled; /myid is available")
		return telegram.RunCommands(ctx)
	}
	commandErrors := make(chan error, 1)
	go func() { commandErrors <- telegram.RunCommands(ctx) }()
	return runNotifications(ctx, config, telegram, commandErrors)
}

func runNotifications(ctx context.Context, config config, telegram *alerts.Telegram, commandErrors <-chan error) error {
	connection, err := nats.Connect(config.natsServers, nats.Name("Telegram alerts"))
	if err != nil {
		return fmt.Errorf("connect NATS: %w", err)
	}
	defer connection.Close()
	jetstream, err := connection.JetStream()
	if err != nil {
		return fmt.Errorf("open JetStream: %w", err)
	}
	if err := observability.EnsureStream(jetstream, config.natsNamespace); err != nil {
		return err
	}
	messages := make(chan *nats.Msg, 64)
	subscription, err := jetstream.ChanSubscribe(
		observability.LogSubject(config.natsNamespace, ">"), messages,
		nats.BindStream(observability.LogStreamName(config.natsNamespace)),
		nats.Durable("telegram-alerts"), nats.DeliverNew(), nats.ManualAck(), nats.AckExplicit(),
	)
	if err != nil {
		return fmt.Errorf("subscribe to operational logs: %w", err)
	}
	defer subscription.Unsubscribe()
	slog.Info("Alerts service started")
	for {
		select {
		case <-ctx.Done():
			return nil
		case err := <-commandErrors:
			return err
		case message, ok := <-messages:
			if !ok {
				return errors.New("operational log subscription closed")
			}
			if err := deliver(ctx, telegram, message); err != nil {
				slog.Error("Deliver operational log to Telegram", "error", err)
			}
		}
	}
}

type telegramSender interface {
	Send(context.Context, observability.Event) error
}

func deliver(ctx context.Context, telegram telegramSender, message *nats.Msg) error {
	var event observability.Event
	if err := json.Unmarshal(message.Data, &event); err != nil {
		_ = message.Term()
		return fmt.Errorf("decode operational log: %w", err)
	}
	if err := telegram.Send(ctx, event); err != nil {
		var sendErr *alerts.SendError
		if errors.As(err, &sendErr) && sendErr.Status >= 400 && sendErr.Status < 500 && sendErr.Status != http.StatusTooManyRequests {
			_ = message.Term()
			return err
		}
		delay := 5 * time.Second
		if errors.As(err, &sendErr) && sendErr.RetryAfter > 0 {
			delay = sendErr.RetryAfter
		}
		_ = message.NakWithDelay(delay)
		return err
	}
	if err := message.Ack(); err != nil {
		return fmt.Errorf("acknowledge operational log: %w", err)
	}
	return nil
}

type config struct {
	natsServers         string
	natsNamespace       string
	telegramToken       string
	telegramAdminChatID string
}

func loadConfig() (config, error) {
	result := config{
		natsServers: os.Getenv("NATS_SERVERS"), natsNamespace: os.Getenv("NATS_NAMESPACE"),
		telegramToken:       strings.TrimSpace(os.Getenv("TELEGRAM_BOT_TOKEN")),
		telegramAdminChatID: strings.TrimSpace(os.Getenv("TELEGRAM_ADMIN_CHAT_ID")),
	}
	if result.natsServers == "" {
		result.natsServers = nats.DefaultURL
	}
	if result.telegramToken == "" {
		return config{}, errors.New("TELEGRAM_BOT_TOKEN is required")
	}
	return result, nil
}
