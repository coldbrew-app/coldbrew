package donatestream

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/coder/websocket"
)

const defaultWebSocketURL = "wss://donate.stream/wss/socket.io/?EIO=4&transport=websocket"

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
	now          func() time.Time
}

func NewSource() *Source {
	return &Source{
		dial:         dialWebSocket,
		webSocketURL: defaultWebSocketURL,
		retryStart:   5 * time.Second,
		retryMax:     60 * time.Second,
		wait:         waitContext,
		now:          time.Now,
	}
}

func (source *Source) Authenticate(ctx context.Context, widgetToken string) error {
	_, err := source.runSession(ctx, widgetToken, nil, true)
	return err
}

func (source *Source) Run(ctx context.Context, widgetToken string, emit func(Donation) error) error {
	retryDelay := source.retryStart
	for ctx.Err() == nil {
		emitted, err := source.runSession(ctx, widgetToken, emit, false)
		if emitted {
			retryDelay = source.retryStart
		}
		if ctx.Err() != nil {
			return nil
		}
		if isUnauthorized(err) {
			return err
		}
		if err != nil {
			slog.Warn("donate.stream listener will reconnect", "error", err, "retry", retryDelay)
		}
		if err := source.wait(ctx, retryDelay); err != nil {
			return nil
		}
		retryDelay = min(retryDelay*2, source.retryMax)
	}
	return nil
}

func (source *Source) runSession(ctx context.Context, widgetToken string, emit func(Donation) error, stopAfterAuthentication bool) (bool, error) {
	socket, err := source.dial(ctx, source.webSocketURL)
	if err != nil {
		return false, fmt.Errorf("open donate.stream websocket: %w", err)
	}
	defer socket.Close()
	emitted := false
	for ctx.Err() == nil {
		body, err := socket.Read(ctx)
		if err != nil {
			return emitted, fmt.Errorf("read donate.stream websocket: %w", err)
		}
		packet := string(body)
		switch {
		case strings.HasPrefix(packet, "0"):
			if err := socket.Write(ctx, []byte("40")); err != nil {
				return emitted, fmt.Errorf("open donate.stream Socket.IO namespace: %w", err)
			}
		case packet == "2":
			if err := socket.Write(ctx, []byte("3")); err != nil {
				return emitted, fmt.Errorf("reply to donate.stream ping: %w", err)
			}
		case strings.HasPrefix(packet, "42"):
			event, err := decodeEvent([]byte(strings.TrimPrefix(packet, "42")))
			if err != nil {
				return emitted, err
			}
			switch event.Name {
			case "auth":
				if err := writeEvent(ctx, socket, "auth.token", map[string]string{"token": widgetToken}); err != nil {
					return emitted, err
				}
			case "authResult":
				var result struct {
					Error string `json:"error"`
				}
				if len(event.Data) != 0 && string(event.Data) != "null" {
					if err := json.Unmarshal(event.Data, &result); err != nil {
						return emitted, fmt.Errorf("invalid donate.stream auth result: %w", err)
					}
				}
				if result.Error != "" {
					return emitted, &RequestError{Unauthorized: true, Operation: "authenticate websocket", Cause: errors.New(result.Error)}
				}
				if stopAfterAuthentication {
					return emitted, nil
				}
				for _, channel := range []string{"donates", "widget-alerts"} {
					if err := writeEvent(ctx, socket, "join", map[string]string{"channel": channel}); err != nil {
						return emitted, err
					}
				}
			case "alert":
				var raw rawAlert
				if err := json.Unmarshal(event.Data, &raw); err != nil {
					return emitted, fmt.Errorf("invalid donate.stream donation: %w", err)
				}
				donation, err := raw.donation(source.now())
				if err != nil {
					return emitted, &RequestError{Operation: "read websocket donation", Cause: err}
				}
				if err := emit(donation); err != nil {
					return emitted, err
				}
				emitted = true
			}
		case packet == "41":
			return emitted, errors.New("donate.stream closed Socket.IO namespace")
		}
	}
	return emitted, nil
}

type socketEvent struct {
	Name string
	Data json.RawMessage
}

func decodeEvent(body []byte) (socketEvent, error) {
	var values []json.RawMessage
	if err := json.Unmarshal(body, &values); err != nil {
		return socketEvent{}, fmt.Errorf("invalid donate.stream Socket.IO event: %w", err)
	}
	if len(values) == 0 {
		return socketEvent{}, errors.New("invalid donate.stream Socket.IO event")
	}
	var name string
	if err := json.Unmarshal(values[0], &name); err != nil || name == "" {
		return socketEvent{}, errors.New("invalid donate.stream Socket.IO event name")
	}
	var data json.RawMessage
	if len(values) > 1 {
		data = values[1]
	}
	return socketEvent{Name: name, Data: data}, nil
}

func writeEvent(ctx context.Context, socket Socket, name string, data any) error {
	body, err := json.Marshal([]any{name, data})
	if err != nil {
		return err
	}
	if err := socket.Write(ctx, append([]byte("42"), body...)); err != nil {
		return fmt.Errorf("write donate.stream websocket: %w", err)
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
