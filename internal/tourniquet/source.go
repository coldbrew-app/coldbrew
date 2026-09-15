package tourniquet

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/coder/websocket"
)

const (
	defaultWebSocketURL = "wss://ws-eu.pusher.com/app/6c6973024a68ab77f121?protocol=7&client=js&version=8.0.1&flash=false"
	donationChannel     = "donation_channel"
	donationEventPrefix = "donation-paid"
)

type Socket interface {
	Read(context.Context) ([]byte, error)
	Write(context.Context, []byte) error
	Close() error
}

type DialSocket func(context.Context, string) (Socket, error)

type Source struct {
	dial         DialSocket
	webSocketURL string
	retryStart   time.Duration
	retryMax     time.Duration
	wait         func(context.Context, time.Duration) error
}

func NewSource() *Source {
	return &Source{
		dial:         dialWebSocket,
		webSocketURL: defaultWebSocketURL,
		retryStart:   5 * time.Second,
		retryMax:     60 * time.Second,
		wait:         waitContext,
	}
}

func (source *Source) Run(ctx context.Context, widgetToken string, emit func(Donation) error) error {
	retryDelay := source.retryStart
	for ctx.Err() == nil {
		emitted, err := source.runSession(ctx, widgetToken, emit)
		if emitted {
			retryDelay = source.retryStart
		}
		if contextDone(ctx) {
			return nil
		}
		if err != nil {
			slog.Warn("Tourniquet listener will reconnect", "error", err, "retry", retryDelay)
		}
		waitErr := source.wait(ctx, retryDelay)
		if contextDone(ctx) {
			return nil
		}
		if waitErr != nil {
			return fmt.Errorf("wait before reconnecting Tourniquet listener: %w", waitErr)
		}
		retryDelay = min(retryDelay*2, source.retryMax)
	}
	return nil
}

func (source *Source) runSession(ctx context.Context, widgetToken string, emit func(Donation) error) (bool, error) {
	socket, err := source.dial(ctx, source.webSocketURL)
	if err != nil {
		return false, fmt.Errorf("open Tourniquet websocket: %w", err)
	}
	defer func() { _ = socket.Close() }()
	emitted := false
	for ctx.Err() == nil {
		body, err := socket.Read(ctx)
		if err != nil {
			return emitted, fmt.Errorf("read Tourniquet websocket: %w", err)
		}
		envelope, err := decodeEnvelope(body)
		if err != nil {
			return emitted, err
		}
		switch envelope.Event {
		case "pusher:connection_established":
			if err := writeEnvelope(ctx, socket, "pusher:subscribe", map[string]string{
				"auth":    "",
				"channel": donationChannel,
			}); err != nil {
				return emitted, err
			}
		case "pusher:ping":
			if err := writeEnvelope(ctx, socket, "pusher:pong", struct{}{}); err != nil {
				return emitted, err
			}
		case donationEventPrefix + widgetToken:
			raw, err := decodeDonation(envelope.Data)
			if err != nil {
				slog.Warn("ignoring invalid Tourniquet donation event", "error", err)
				continue
			}
			donation, accepted, err := raw.donation()
			if err != nil {
				slog.Warn("ignoring invalid Tourniquet donation", "error", err)
				continue
			}
			if !accepted {
				continue
			}
			if err := emit(donation); err != nil {
				return emitted, err
			}
			emitted = true
		case "pusher:error":
			return emitted, errors.New("tourniquet websocket reported an error")
		}
	}
	return emitted, nil
}

type envelope struct {
	Event string          `json:"event"`
	Data  json.RawMessage `json:"data"`
}

func decodeEnvelope(body []byte) (envelope, error) {
	var value envelope
	if err := json.Unmarshal(body, &value); err != nil {
		return envelope{}, fmt.Errorf("invalid Tourniquet websocket event: %w", err)
	}
	if value.Event == "" {
		return envelope{}, errors.New("invalid Tourniquet websocket event name")
	}
	return value, nil
}

func decodeDonation(body json.RawMessage) (rawDonation, error) {
	var encoded string
	if err := json.Unmarshal(body, &encoded); err == nil {
		body = []byte(encoded)
	}
	var value rawDonation
	if err := json.Unmarshal(body, &value); err != nil {
		return rawDonation{}, errors.New("invalid Tourniquet donation data")
	}
	return value, nil
}

func writeEnvelope(ctx context.Context, socket Socket, event string, data any) error {
	body, err := json.Marshal(struct {
		Event string `json:"event"`
		Data  any    `json:"data"`
	}{Event: event, Data: data})
	if err != nil {
		return err
	}
	if err := socket.Write(ctx, body); err != nil {
		return fmt.Errorf("write Tourniquet websocket: %w", err)
	}
	return nil
}

func contextDone(ctx context.Context) bool { return ctx.Err() != nil }

func waitContext(ctx context.Context, duration time.Duration) error {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

type webSocketAdapter struct{ connection *websocket.Conn }

func dialWebSocket(ctx context.Context, rawURL string) (Socket, error) {
	connection, _, err := websocket.Dial(ctx, rawURL, nil)
	if err != nil {
		return nil, err
	}
	return &webSocketAdapter{connection: connection}, nil
}

func (adapter *webSocketAdapter) Read(ctx context.Context) ([]byte, error) {
	_, body, err := adapter.connection.Read(ctx)
	return body, err
}

func (adapter *webSocketAdapter) Write(ctx context.Context, body []byte) error {
	return adapter.connection.Write(ctx, websocket.MessageText, body)
}

func (adapter *webSocketAdapter) Close() error {
	return adapter.connection.Close(websocket.StatusNormalClosure, "")
}
