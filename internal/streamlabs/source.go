package streamlabs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"net/url"
	"strings"
	"time"

	"github.com/coder/websocket"
)

const defaultSocketURL = "wss://sockets.streamlabs.com/socket.io/"

type Socket interface {
	Read(context.Context) ([]byte, error)
	Write(context.Context, []byte) error
	Close() error
}

type DialSocket func(context.Context, string) (Socket, error)

type Source struct {
	client     *Client
	dial       DialSocket
	socketURL  string
	retryStart time.Duration
	retryMax   time.Duration
	wait       func(context.Context, time.Duration) error
	jitter     func(time.Duration) time.Duration
}

func NewSource(client *Client) *Source {
	return &Source{
		client:     client,
		dial:       dialSocket,
		socketURL:  defaultSocketURL,
		retryStart: 5 * time.Second,
		retryMax:   60 * time.Second,
		wait:       waitContext,
		jitter:     jitterDelay,
	}
}

// Run notifies after each connection and donation event until the context is cancelled or credentials are unauthorized.
func (source *Source) Run(ctx context.Context, accessToken string, notify func() error) error {
	retryDelay := source.retryStart
	for ctx.Err() == nil {
		socketToken, err := source.client.SocketToken(ctx, accessToken)
		if err == nil {
			connected, sessionErr := source.runSession(ctx, socketToken, notify)
			if connected {
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
			slog.Warn("Streamlabs listener will reconnect", "error", err, "retry", retryDelay)
		}
		if err := source.wait(ctx, source.jitter(retryDelay)); err != nil {
			return nil
		}
		retryDelay = min(retryDelay*2, source.retryMax)
	}
	return nil
}

func jitterDelay(delay time.Duration) time.Duration {
	percent := 80 + rand.IntN(41)
	return delay * time.Duration(percent) / 100
}

func (source *Source) runSession(ctx context.Context, socketToken string, notify func() error) (bool, error) {
	socketURL, err := streamlabsSocketURL(source.socketURL, socketToken)
	if err != nil {
		return false, err
	}
	socket, err := source.dial(ctx, socketURL)
	if err != nil {
		return false, fmt.Errorf("open Streamlabs Socket.IO websocket: %w", err)
	}
	defer socket.Close()

	connected := false
	for ctx.Err() == nil {
		body, err := socket.Read(ctx)
		if err != nil {
			return connected, fmt.Errorf("read Streamlabs Socket.IO websocket: %w", err)
		}
		for _, packet := range strings.Split(string(body), "\x1e") {
			if packet == "" {
				continue
			}
			switch {
			case strings.HasPrefix(packet, "0"):
				if err := validateOpenPacket(packet[1:]); err != nil {
					return connected, err
				}
				if err := socket.Write(ctx, []byte("40")); err != nil {
					return connected, fmt.Errorf("join Streamlabs Socket.IO namespace: %w", err)
				}
			case packet == "40" || strings.HasPrefix(packet, "40{"):
				if connected {
					continue
				}
				connected = true
				if err := notify(); err != nil {
					return connected, err
				}
			case strings.HasPrefix(packet, "44"):
				return connected, errors.New("Streamlabs Socket.IO authentication failed")
			case strings.HasPrefix(packet, "2"):
				if err := socket.Write(ctx, []byte("3"+packet[1:])); err != nil {
					return connected, fmt.Errorf("answer Streamlabs Socket.IO heartbeat: %w", err)
				}
			case strings.HasPrefix(packet, "42"):
				if !connected {
					return false, errors.New("Streamlabs Socket.IO event arrived before connection")
				}
				donationEvent, err := decodeEventPacket(packet[2:])
				if err != nil {
					return connected, err
				}
				if donationEvent {
					if err := notify(); err != nil {
						return connected, err
					}
				}
			}
		}
	}
	return connected, nil
}

func streamlabsSocketURL(baseURL, socketToken string) (string, error) {
	parsed, err := url.Parse(baseURL)
	if err != nil {
		return "", fmt.Errorf("parse Streamlabs socket URL: %w", err)
	}
	parameters := parsed.Query()
	parameters.Set("EIO", "4")
	parameters.Set("transport", "websocket")
	parameters.Set("token", socketToken)
	parsed.RawQuery = parameters.Encode()
	return parsed.String(), nil
}

func validateOpenPacket(body string) error {
	var handshake struct {
		SID          string `json:"sid"`
		PingInterval int    `json:"pingInterval"`
		PingTimeout  int    `json:"pingTimeout"`
	}
	if err := json.Unmarshal([]byte(body), &handshake); err != nil {
		return fmt.Errorf("invalid Streamlabs Engine.IO handshake: %w", err)
	}
	if handshake.SID == "" || handshake.PingInterval <= 0 || handshake.PingTimeout <= 0 {
		return errors.New("invalid Streamlabs Engine.IO handshake")
	}
	return nil
}

func decodeEventPacket(body string) (bool, error) {
	var event []json.RawMessage
	if err := json.Unmarshal([]byte(body), &event); err != nil {
		return false, fmt.Errorf("invalid Streamlabs Socket.IO event: %w", err)
	}
	if len(event) != 2 {
		return false, errors.New("invalid Streamlabs Socket.IO event")
	}
	var name string
	if err := json.Unmarshal(event[0], &name); err != nil || name == "" {
		return false, errors.New("invalid Streamlabs Socket.IO event name")
	}
	if name != "event" {
		return false, nil
	}
	var payload struct {
		For     string            `json:"for"`
		Type    string            `json:"type"`
		Message []json.RawMessage `json:"message"`
	}
	if err := json.Unmarshal(event[1], &payload); err != nil {
		return false, fmt.Errorf("invalid Streamlabs event payload: %w", err)
	}
	if payload.Type != "donation" || (payload.For != "" && payload.For != "streamlabs") {
		return false, nil
	}
	if len(payload.Message) == 0 {
		return false, errors.New("invalid Streamlabs donation event")
	}
	return true, nil
}

func isUnauthorized(err error) bool {
	var requestError *RequestError
	return errors.As(err, &requestError) && requestError.Unauthorized
}

type websocketAdapter struct{ connection *websocket.Conn }

func dialSocket(ctx context.Context, rawURL string) (Socket, error) {
	connection, _, err := websocket.Dial(ctx, rawURL, nil)
	if err != nil {
		return nil, err
	}
	return &websocketAdapter{connection: connection}, nil
}

func (adapter *websocketAdapter) Read(ctx context.Context) ([]byte, error) {
	_, body, err := adapter.connection.Read(ctx)
	return body, err
}

func (adapter *websocketAdapter) Write(ctx context.Context, body []byte) error {
	return adapter.connection.Write(ctx, websocket.MessageText, body)
}

func (adapter *websocketAdapter) Close() error {
	return adapter.connection.Close(websocket.StatusNormalClosure, "")
}
