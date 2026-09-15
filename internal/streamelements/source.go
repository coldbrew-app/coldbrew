package streamelements

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	mathrand "math/rand/v2"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/coder/websocket"
)

const (
	defaultSocketURL        = "wss://astro.streamelements.com"
	tipsTopic               = "channel.tips"
	defaultSubscribeTimeout = 15 * time.Second
)

type Socket interface {
	Read(context.Context) ([]byte, error)
	Write(context.Context, []byte) error
	Close() error
}

type DialSocket func(context.Context, string) (Socket, error)

type Source struct {
	dial             DialSocket
	socketURL        string
	retryStart       time.Duration
	retryMax         time.Duration
	subscribeTimeout time.Duration
	wait             func(context.Context, time.Duration) error
	jitter           func(time.Duration) time.Duration
	nonce            func() (string, error)
}

func NewSource() *Source {
	return &Source{
		dial:             dialSocket,
		socketURL:        defaultSocketURL,
		retryStart:       5 * time.Second,
		retryMax:         60 * time.Second,
		subscribeTimeout: defaultSubscribeTimeout,
		wait:             waitContext,
		jitter:           jitterDelay,
		nonce:            subscriptionNonce,
	}
}

// Run emits completed tips until the context is cancelled or credentials are unauthorized.
func (source *Source) Run(
	ctx context.Context,
	accessToken string,
	channelID string,
	emit func(Donation) error,
) error {
	channelID = strings.TrimSpace(channelID)
	if accessToken == "" || channelID == "" {
		return requestValidationError("start Astro listener", errors.New("missing access token or channel id"))
	}

	retryDelay := source.retryStart
	reconnectToken := ""
	restoreSubscription := false
	room := channelID
	for ctx.Err() == nil {
		usingReconnectToken := reconnectToken != ""
		socketURL, err := astroSocketURL(source.socketURL, reconnectToken)
		result := sessionResult{}
		if err == nil {
			result, err = source.runSession(
				ctx,
				socketURL,
				accessToken,
				room,
				restoreSubscription,
				emit,
			)
		}
		if result.room != "" {
			room = result.room
		}
		if contextDone(ctx) {
			return nil
		}
		if isUnauthorized(err) {
			return err
		}
		if result.reconnectToken != "" {
			reconnectToken = result.reconnectToken
			restoreSubscription = result.subscribed
			retryDelay = source.retryStart
			continue
		}
		if usingReconnectToken {
			// An invalid or expired reconnect token must not poison later attempts.
			reconnectToken = ""
			restoreSubscription = false
		}
		if result.subscribed || result.emitted {
			retryDelay = source.retryStart
		}
		if err != nil {
			slog.WarnContext(ctx, "StreamElements listener will reconnect", "error", err, "retry", retryDelay)
		}
		if waitErr := source.wait(ctx, source.jitter(retryDelay)); waitErr != nil {
			if contextDone(ctx) {
				return nil
			}
			return fmt.Errorf("wait before reconnecting StreamElements listener: %w", waitErr)
		}
		retryDelay = min(retryDelay*2, source.retryMax)
	}
	return nil
}

type sessionResult struct {
	subscribed     bool
	emitted        bool
	reconnectToken string
	room           string
}

func (source *Source) runSession(
	ctx context.Context,
	socketURL string,
	accessToken string,
	requestedRoom string,
	restored bool,
	emit func(Donation) error,
) (sessionResult, error) {
	establishCtx, cancelEstablish := context.WithTimeout(ctx, source.subscribeTimeout)
	defer cancelEstablish()

	socket, err := source.dial(establishCtx, socketURL)
	if err != nil {
		var requestError *RequestError
		if errors.As(err, &requestError) {
			return sessionResult{}, requestError
		}
		// Do not include a reconnect URL (which can contain a token) in errors or logs.
		return sessionResult{}, requestValidationError("open Astro websocket", errors.New("websocket dial failed"))
	}
	defer func() { _ = socket.Close() }()

	result := sessionResult{}
	subscribeNonce := ""
	welcomeReceived := false
	activeRoom := requestedRoom
	for ctx.Err() == nil {
		readCtx := ctx
		if !result.subscribed {
			readCtx = establishCtx
		}
		body, readErr := socket.Read(readCtx)
		if readErr != nil {
			return result, fmt.Errorf("read StreamElements Astro websocket: %w", readErr)
		}

		var envelope astroEnvelope
		decodeErr := json.Unmarshal(body, &envelope)
		if decodeErr != nil || envelope.Type == "" {
			return result, errors.New("invalid StreamElements Astro message")
		}
		switch envelope.Type {
		case "welcome":
			if welcomeReceived {
				continue
			}
			var welcome struct {
				ClientID string `json:"client_id"`
			}
			decodeErr := json.Unmarshal(envelope.Data, &welcome)
			if decodeErr != nil || welcome.ClientID == "" {
				return result, errors.New("invalid StreamElements Astro welcome")
			}
			welcomeReceived = true
			if restored {
				result.subscribed = true
				result.room = activeRoom
				cancelEstablish()
				continue
			}
			subscribeNonce, err = source.nonce()
			if err != nil || subscribeNonce == "" {
				return result, errors.New("create StreamElements Astro subscription nonce")
			}
			request := astroSubscribe{
				Type:  "subscribe",
				Nonce: subscribeNonce,
				Data: astroSubscription{
					Topic:     tipsTopic,
					Room:      requestedRoom,
					Token:     accessToken,
					TokenType: "oauth2",
				},
			}
			encoded, err := json.Marshal(request)
			if err != nil {
				return result, errors.New("encode StreamElements Astro subscription")
			}
			if err := socket.Write(establishCtx, encoded); err != nil {
				return result, fmt.Errorf("subscribe to StreamElements Astro: %w", err)
			}
		case "response":
			if envelope.Error != "" {
				return result, astroResponseError(envelope.Error)
			}
			if result.subscribed || subscribeNonce == "" || envelope.Nonce != subscribeNonce {
				continue
			}
			var response astroSubscriptionResponse
			if err := json.Unmarshal(envelope.Data, &response); err != nil ||
				response.Topic != tipsTopic || response.Room == "" {
				return result, errors.New("invalid StreamElements Astro subscription response")
			}
			activeRoom = response.Room
			result.room = activeRoom
			result.subscribed = true
			cancelEstablish()
		case "message":
			if envelope.Topic != tipsTopic || envelope.Room != activeRoom {
				continue
			}
			if !result.subscribed {
				return result, errors.New("StreamElements tip arrived before subscription")
			}
			var raw rawTip
			if err := json.Unmarshal(envelope.Data, &raw); err != nil {
				return result, errors.New("invalid StreamElements tip message")
			}
			donation, err := raw.donation(activeRoom)
			if err != nil {
				return result, fmt.Errorf("invalid StreamElements tip: %w", err)
			}
			if err := emit(donation); err != nil {
				return result, err
			}
			result.emitted = true
		case "reconnect":
			var reconnect struct {
				Token string `json:"reconnect_token"`
			}
			if err := json.Unmarshal(envelope.Data, &reconnect); err != nil || reconnect.Token == "" {
				return result, errors.New("invalid StreamElements Astro reconnect message")
			}
			result.reconnectToken = reconnect.Token
			result.room = activeRoom
			return result, nil
		}
	}
	return result, nil
}

type astroEnvelope struct {
	Type  string          `json:"type"`
	Nonce string          `json:"nonce"`
	Topic string          `json:"topic"`
	Room  string          `json:"room"`
	Data  json.RawMessage `json:"data"`
	Error string          `json:"error"`
}

type astroSubscribe struct {
	Type  string            `json:"type"`
	Nonce string            `json:"nonce"`
	Data  astroSubscription `json:"data"`
}

type astroSubscription struct {
	Topic     string `json:"topic"`
	Room      string `json:"room"`
	Token     string `json:"token"`
	TokenType string `json:"token_type"`
}

type astroSubscriptionResponse struct {
	Topic string `json:"topic"`
	Room  string `json:"room"`
}

func astroResponseError(code string) error {
	operation := "subscribe to Astro channel.tips"
	switch code {
	case "err_unauthorized":
		return &RequestError{
			Unauthorized: true,
			Operation:    operation,
			Cause:        errors.New("authorization rejected"),
		}
	case "err_internal_error", "err_bad_request", "err_deadline_exceeded", "rate_limit_exceeded", "invalid_message_type":
		return requestValidationError(operation, errors.New(code))
	default:
		return requestValidationError(operation, errors.New("unknown Astro error"))
	}
}

func astroSocketURL(baseURL, reconnectToken string) (string, error) {
	parsed, err := url.Parse(baseURL)
	if err != nil {
		return "", requestValidationError("parse Astro websocket URL", errors.New("invalid websocket URL"))
	}
	if reconnectToken != "" {
		parameters := parsed.Query()
		parameters.Set("reconnect_token", reconnectToken)
		parsed.RawQuery = parameters.Encode()
	}
	return parsed.String(), nil
}

func subscriptionNonce() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(value[:]), nil
}

func contextDone(ctx context.Context) bool { return ctx.Err() != nil }

func isUnauthorized(err error) bool {
	var requestError *RequestError
	return errors.As(err, &requestError) && requestError.Unauthorized
}

func jitterDelay(delay time.Duration) time.Duration {
	// Jitter is only used to spread reconnect attempts.
	percent := 80 + mathrand.IntN(41) //nolint:gosec
	return delay * time.Duration(percent) / 100
}

type websocketAdapter struct{ connection *websocket.Conn }

func dialSocket(ctx context.Context, rawURL string) (Socket, error) {
	// websocket.Dial owns and closes the handshake response body.
	connection, response, err := websocket.Dial(ctx, rawURL, nil) //nolint:bodyclose
	if err != nil {
		status := 0
		if response != nil {
			status = response.StatusCode
		}
		return nil, &RequestError{
			Unauthorized: status == http.StatusUnauthorized,
			Status:       status,
			Operation:    "open Astro websocket",
			Cause:        errors.New("websocket handshake failed"),
		}
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
