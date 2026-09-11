package donationalerts

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"time"

	"github.com/coder/websocket"
)

const defaultWebSocketURL = "wss://centrifugo.donationalerts.com/connection/websocket"

var socketUUIDPattern = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

type Socket interface {
	Read(context.Context) ([]byte, error)
	Write(context.Context, []byte) error
	Close() error
}

type DialSocket func(context.Context, string) (Socket, error)

type Source struct {
	client       *Client
	dial         DialSocket
	webSocketURL string
	retryStart   time.Duration
	retryMax     time.Duration
	wait         func(context.Context, time.Duration) error
}

func NewSource(client *Client) *Source {
	return &Source{
		client:       client,
		dial:         dialWebSocket,
		webSocketURL: defaultWebSocketURL,
		retryStart:   5 * time.Second,
		retryMax:     60 * time.Second,
		wait:         waitContext,
	}
}

// Run emits donations until the context is cancelled or credentials are unauthorized.
func (source *Source) Run(ctx context.Context, accessToken string, emit func(Donation) error) error {
	retryDelay := source.retryStart
	for ctx.Err() == nil {
		profile, err := source.client.SocketProfile(ctx, accessToken)
		if err == nil {
			result, sessionErr := source.runSession(ctx, accessToken, profile, emit)
			if result.subscribed || result.emitted {
				retryDelay = source.retryStart
			}
			err = sessionErr
		}
		if ctx.Err() != nil {
			return nil
		}
		if isUnauthorized(err) {
			return err
		}
		if err != nil {
			slog.Warn("DonationAlerts listener will reconnect", "error", err, "retry", retryDelay)
		}
		if err := source.wait(ctx, retryDelay); err != nil {
			return nil
		}
		retryDelay = min(retryDelay*2, source.retryMax)
	}
	return nil
}

type sessionResult struct {
	subscribed bool
	emitted    bool
}

func (source *Source) runSession(ctx context.Context, accessToken string, profile SocketProfile, emit func(Donation) error) (sessionResult, error) {
	socket, err := source.dial(ctx, source.webSocketURL)
	if err != nil {
		return sessionResult{}, fmt.Errorf("open DonationAlerts websocket: %w", err)
	}
	defer socket.Close()
	if err := writeJSON(ctx, socket, map[string]any{"params": map[string]string{"token": profile.SocketConnectionToken}, "id": 1}); err != nil {
		return sessionResult{}, err
	}

	channel := "$alerts:donation_" + profile.UserID
	result := sessionResult{}
	for ctx.Err() == nil {
		body, err := socket.Read(ctx)
		if err != nil {
			return result, fmt.Errorf("read DonationAlerts websocket: %w", err)
		}
		for _, message := range bytes.Split(body, []byte{'\n'}) {
			message = bytes.TrimSpace(message)
			if len(message) == 0 {
				continue
			}
			event, decoderErr := decodeSocketEvent(message)
			if decoderErr != nil {
				return result, fmt.Errorf("%w; raw message: %s", decoderErr, message)
			}
			if event.kind == "unhandled" {
				logUnhandledSocketMessage(ctx, event, message)
				continue
			}
			if event.kind == "ping" {
				if err := writeJSON(ctx, socket, struct{}{}); err != nil {
					return result, err
				}
				continue
			}
			if event.kind == "step 1" {
				token, err := source.client.ChannelToken(ctx, accessToken, channel, event.Result.Client)
				if err != nil {
					return result, fmt.Errorf("authorize DonationAlerts channel: %w; raw message: %s", err, message)
				}
				if err := writeJSON(ctx, socket, map[string]any{"id": 2, "method": 1, "params": map[string]string{"channel": channel, "token": token}}); err != nil {
					return result, err
				}
				continue
			}
			if event.kind == "step 2" {
				result.subscribed = true
				continue
			}
			if event.kind == "user client" {
				continue
			}
			if event.kind == "donation" {
				var raw rawDonation
				if err := json.Unmarshal(event.Result.Data.Data, &raw); err != nil {
					return result, fmt.Errorf("invalid DonationAlerts donation: %w; raw message: %s", err, message)
				}
				donation, err := raw.donation()
				if err != nil {
					return result, fmt.Errorf("%w; raw message: %s", err, message)
				}
				if err := emit(donation); err != nil {
					return result, fmt.Errorf("emit DonationAlerts donation: %w; raw message: %s", err, message)
				}
				result.emitted = true
			}
		}
	}
	return result, nil
}

func logUnhandledSocketMessage(ctx context.Context, event socketEvent, body []byte) {
	attributes := []any{"rawMessage", string(body)}
	if event.ID != nil {
		attributes = append(attributes, "id", *event.ID)
	}
	if event.Result.Type != nil {
		attributes = append(attributes, "type", *event.Result.Type)
	}
	if event.Result.Channel != nil {
		attributes = append(attributes, "channel", *event.Result.Channel)
	}
	slog.WarnContext(ctx, "DonationAlerts websocket message ignored", attributes...)
}

type socketEvent struct {
	kind   string
	ID     *int `json:"id"`
	Result struct {
		Client      string   `json:"client"`
		Version     *string  `json:"version"`
		Recoverable *bool    `json:"recoverable"`
		Sequence    *float64 `json:"seq"`
		Epoch       *string  `json:"epoch"`
		Offset      *float64 `json:"offset"`
		Channel     *string  `json:"channel"`
		Type        *int     `json:"type"`
		Data        struct {
			Data json.RawMessage `json:"data"`
			Info *struct {
				User   string `json:"user"`
				Client string `json:"client"`
			} `json:"info"`
		} `json:"data"`
	} `json:"result"`
}

func decodeSocketEvent(body []byte) (socketEvent, error) {
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(body, &envelope); err != nil {
		return socketEvent{}, fmt.Errorf("invalid DonationAlerts websocket message: %w", err)
	}
	if envelope != nil && len(envelope) == 0 {
		return socketEvent{kind: "ping"}, nil
	}

	var event socketEvent
	if err := json.Unmarshal(body, &event); err != nil {
		return socketEvent{}, fmt.Errorf("invalid DonationAlerts websocket message: %w", err)
	}
	switch {
	case event.ID != nil && *event.ID == 1:
		if !socketUUIDPattern.MatchString(event.Result.Client) || event.Result.Version == nil {
			return socketEvent{}, errors.New("invalid DonationAlerts websocket step 1")
		}
		event.kind = "step 1"
	case event.ID != nil && *event.ID == 2:
		if event.Result.Recoverable == nil || event.Result.Sequence == nil || event.Result.Epoch == nil || event.Result.Offset == nil {
			return socketEvent{}, errors.New("invalid DonationAlerts websocket step 2")
		}
		event.kind = "step 2"
	case event.Result.Type != nil && *event.Result.Type == 1:
		if event.Result.Channel == nil || event.Result.Data.Info == nil || event.Result.Data.Info.User == "" || !socketUUIDPattern.MatchString(event.Result.Data.Info.Client) {
			return socketEvent{}, errors.New("invalid DonationAlerts websocket user client event")
		}
		event.kind = "user client"
	case event.Result.Channel != nil && len(event.Result.Data.Data) != 0:
		event.kind = "donation"
	default:
		event.kind = "unhandled"
	}
	return event, nil
}

func writeJSON(ctx context.Context, socket Socket, value any) error {
	body, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if err := socket.Write(ctx, body); err != nil {
		return fmt.Errorf("write DonationAlerts websocket: %w", err)
	}
	return nil
}

func isUnauthorized(err error) bool {
	var requestError *RequestError
	return errors.As(err, &requestError) && requestError.Unauthorized
}

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
