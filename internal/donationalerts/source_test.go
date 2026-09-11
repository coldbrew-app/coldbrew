package donationalerts

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
)

const (
	testSocketClientID = "d558c046-c679-43e3-a62d-65989ab55f7c"
	testChannel        = "$alerts:donation_42"
	testDonation       = `{"id":1,"username":"Streamer","message":"Thank you","amount":"10.00","currency":"USD","created_at":"2026-08-22 12:00:00"}`
)

type receivedCommand struct {
	ID     uint64          `json:"id"`
	Method int             `json:"method"`
	Params json.RawMessage `json:"params"`
}

func TestSourceRefreshesExpiringConnectionAndSubscription(t *testing.T) {
	var profileRequests atomic.Int32
	var channelRequests atomic.Int32
	server := newDonationAlertsServer(t, func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/api/v1/user/oauth":
			requestNumber := profileRequests.Add(1)
			_, _ = fmt.Fprintf(writer, `{"data":{"id":42,"socket_connection_token":"socket-token-%d"}}`, requestNumber)
		case "/api/v1/centrifuge/subscribe":
			requestNumber := channelRequests.Add(1)
			_, _ = fmt.Fprintf(writer, `{"channels":[{"channel":"$alerts:donation_42","token":"channel-token-%d"}]}`, requestNumber)
		default:
			http.NotFound(writer, request)
		}
	}, func(ctx context.Context, connection *websocket.Conn, _ int32) {
		refreshes := make([]receivedCommand, 0, 2)
		for {
			command, err := readSocketCommand(ctx, connection)
			if err != nil {
				return
			}
			switch command.Method {
			case 0:
				writeSocketReply(t, ctx, connection, command.ID, map[string]any{"client": testSocketClientID, "version": "2.2.1", "expires": true, "ttl": 1})
			case 1:
				writeSocketReply(t, ctx, connection, command.ID, map[string]any{"recoverable": true, "epoch": "epoch", "seq": 0, "gen": 0, "expires": true, "ttl": 1})
			case 7:
				writeSocketReply(t, ctx, connection, command.ID, struct{}{})
			case 10:
				if !bytes.Contains(command.Params, []byte(`"token":"socket-token-2"`)) {
					t.Errorf("refresh params = %s", command.Params)
				}
				refreshes = append(refreshes, command)
			case 11:
				if !bytes.Contains(command.Params, []byte(`"token":"channel-token-2"`)) {
					t.Errorf("subscription refresh params = %s", command.Params)
				}
				refreshes = append(refreshes, command)
			}
			if len(refreshes) == 2 {
				for index := len(refreshes) - 1; index >= 0; index-- {
					writeSocketReply(t, ctx, connection, refreshes[index].ID, map[string]any{"expires": false})
				}
				writeDonation(t, ctx, connection)
				return
			}
		}
	})
	defer server.Close()

	client := NewClient(server.Client())
	client.BaseURL = server.URL
	source := NewSource(client)
	source.webSocketURL = websocketURL(server.URL)
	source.retryStart = 10 * time.Millisecond
	source.retryMax = 20 * time.Millisecond
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var received Donation
	err := source.Run(ctx, "access-token", func(donation Donation) error {
		received = donation
		cancel()
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if received.SourceDonationID != "1" || received.Amount != "10.00" {
		t.Fatalf("unexpected donation: %#v", received)
	}
	if profileRequests.Load() < 2 || channelRequests.Load() < 2 {
		t.Fatalf("profile requests=%d channel requests=%d; expected both tokens to refresh", profileRequests.Load(), channelRequests.Load())
	}
}

func TestSourceReconnectsAndResubscribesAfterConnectionReset(t *testing.T) {
	var socketConnections atomic.Int32
	firstEmitted := make(chan struct{}, 1)
	var logs bytes.Buffer
	previousLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, nil)))
	defer slog.SetDefault(previousLogger)
	server := newDonationAlertsServer(t, func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/api/v1/user/oauth":
			_, _ = writer.Write([]byte(`{"data":{"id":42,"socket_connection_token":"socket-token"}}`))
		case "/api/v1/centrifuge/subscribe":
			_, _ = writer.Write([]byte(`{"channels":[{"channel":"$alerts:donation_42","token":"channel-token"}]}`))
		default:
			http.NotFound(writer, request)
		}
	}, func(ctx context.Context, connection *websocket.Conn, connectionNumber int32) {
		socketConnections.Store(connectionNumber)
		for {
			command, err := readSocketCommand(ctx, connection)
			if err != nil {
				return
			}
			switch command.Method {
			case 0:
				writeSocketReply(t, ctx, connection, command.ID, map[string]any{"client": testSocketClientID, "version": "2.2.1"})
			case 1:
				if connectionNumber == 1 {
					writeSocketReply(t, ctx, connection, command.ID, map[string]any{"recoverable": true, "epoch": "epoch", "seq": 7, "gen": 1})
					writeDonationWithPosition(t, ctx, connection, 1, 8, 1)
					select {
					case <-firstEmitted:
					case <-time.After(time.Second):
						t.Error("first donation was not emitted before reset")
						return
					}
					writeSocketLeave(t, ctx, connection)
					_ = connection.CloseNow()
					return
				}
				for _, expected := range []string{`"recover":true`, `"epoch":"epoch"`, `"seq":8`, `"gen":1`} {
					if !bytes.Contains(command.Params, []byte(expected)) {
						t.Errorf("recovery params = %s; missing %s", command.Params, expected)
					}
				}
				writeSocketReply(t, ctx, connection, command.ID, map[string]any{
					"recoverable": true,
					"recovered":   true,
					"epoch":       "epoch",
					"seq":         10,
					"gen":         1,
					"publications": []any{
						publicationValue(t, 3, 10, 1),
						publicationValue(t, 2, 9, 1),
					},
				})
				writeDonationWithPosition(t, ctx, connection, 4, 11, 1)
			case 7:
				writeSocketReply(t, ctx, connection, command.ID, struct{}{})
			}
		}
	})
	defer server.Close()

	client := NewClient(server.Client())
	client.BaseURL = server.URL
	source := NewSource(client)
	source.webSocketURL = websocketURL(server.URL)
	source.retryStart = 10 * time.Millisecond
	source.retryMax = 20 * time.Millisecond
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	received := make([]string, 0, 4)
	err := source.Run(ctx, "access-token", func(donation Donation) error {
		received = append(received, donation.SourceDonationID)
		if donation.SourceDonationID == "1" {
			firstEmitted <- struct{}{}
		}
		if len(received) == 4 {
			cancel()
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if socketConnections.Load() < 2 {
		t.Fatalf("websocket connections = %d; want at least 2", socketConnections.Load())
	}
	if !reflect.DeepEqual(received, []string{"1", "2", "3", "4"}) {
		t.Fatalf("donations = %v; want chronological recovery", received)
	}
	if strings.Contains(logs.String(), `"level":"WARN"`) {
		t.Fatalf("routine reconnect or leave produced a warning: %s", logs.String())
	}
}

func TestSocketSessionWarnsWhenRecoveryIsIncomplete(t *testing.T) {
	var logs bytes.Buffer
	previousLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, nil)))
	defer slog.SetDefault(previousLogger)

	server := newDonationAlertsServer(t, http.NotFound, func(ctx context.Context, connection *websocket.Conn, _ int32) {
		for {
			command, err := readSocketCommand(ctx, connection)
			if err != nil {
				return
			}
			switch command.Method {
			case methodConnect:
				writeSocketReply(t, ctx, connection, command.ID, map[string]any{"client": testSocketClientID, "version": "2.2.1"})
			case methodSubscribe:
				for _, expected := range []string{`"recover":true`, `"epoch":"old-epoch"`, `"seq":7`, `"gen":1`} {
					if !bytes.Contains(command.Params, []byte(expected)) {
						t.Errorf("recovery params = %s; missing %s", command.Params, expected)
					}
				}
				writeSocketReply(t, ctx, connection, command.ID, map[string]any{
					"recoverable": true,
					"recovered":   false,
					"epoch":       "new-epoch",
					"seq":         9,
					"gen":         2,
					"publications": []any{
						publicationValue(t, 9, 9, 2),
						publicationValue(t, 8, 8, 2),
					},
				})
			}
		}
	})
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	received := make([]string, 0, 2)
	session := socketSession{
		url:             websocketURL(server.URL),
		connectionToken: "socket-token",
		channel:         testChannel,
		position:        streamPosition{epoch: "old-epoch", sequence: 7, generation: 1, valid: true},
		pingInterval:    time.Second,
		commandTimeout:  time.Second,
		refreshSubscriptionToken: func(context.Context, string) (string, error) {
			return "channel-token", nil
		},
		onPublication: func(body []byte) error {
			var donation rawDonation
			if err := json.Unmarshal(body, &donation); err != nil {
				return err
			}
			received = append(received, fmt.Sprint(donation.ID))
			if len(received) == 2 {
				cancel()
			}
			return nil
		},
	}
	result, err := session.run(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(received, []string{"8", "9"}) {
		t.Fatalf("recovered donations = %v; want chronological order", received)
	}
	if result.position.epoch != "new-epoch" || result.position.sequence != 9 || result.position.generation != 2 {
		t.Fatalf("position = %+v; want new stream baseline", result.position)
	}
	for _, detail := range []string{"DonationAlerts subscription could not fully recover", `"previousEpoch":"old-epoch"`, `"currentEpoch":"new-epoch"`, `"rawMessage"`} {
		if !strings.Contains(logs.String(), detail) {
			t.Fatalf("recovery warning is missing %q: %s", detail, logs.String())
		}
	}
}

func TestSourceSendsProtocolHeartbeatAndAnswersNativePing(t *testing.T) {
	var heartbeatSeen atomic.Bool
	heartbeatDone := make(chan struct{})
	nativePong := make(chan error, 1)
	server := newDonationAlertsServer(t, func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/api/v1/user/oauth":
			_, _ = writer.Write([]byte(`{"data":{"id":42,"socket_connection_token":"socket-token"}}`))
		case "/api/v1/centrifuge/subscribe":
			_, _ = writer.Write([]byte(`{"channels":[{"channel":"$alerts:donation_42","token":"channel-token"}]}`))
		default:
			http.NotFound(writer, request)
		}
	}, func(ctx context.Context, connection *websocket.Conn, _ int32) {
		for {
			command, err := readSocketCommand(ctx, connection)
			if err != nil {
				return
			}
			switch command.Method {
			case 0:
				writeSocketReply(t, ctx, connection, command.ID, map[string]any{"client": testSocketClientID, "version": "2.2.1"})
			case 1:
				writeSocketReply(t, ctx, connection, command.ID, map[string]any{"recoverable": true, "epoch": "epoch", "seq": 0, "gen": 0})
				go func() {
					pingCtx, cancel := context.WithTimeout(ctx, time.Second)
					defer cancel()
					err := connection.Ping(pingCtx)
					nativePong <- err
					if err == nil {
						<-heartbeatDone
						writeDonation(t, ctx, connection)
					}
				}()
			case 7:
				heartbeatSeen.Store(true)
				writeSocketReply(t, ctx, connection, command.ID, struct{}{})
				close(heartbeatDone)
			}
		}
	})
	defer server.Close()

	client := NewClient(server.Client())
	client.BaseURL = server.URL
	source := NewSource(client)
	source.webSocketURL = websocketURL(server.URL)
	source.pingInterval = 20 * time.Millisecond
	source.commandTimeout = 200 * time.Millisecond
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := source.Run(ctx, "access-token", func(Donation) error {
		cancel()
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if !heartbeatSeen.Load() {
		t.Fatal("Centrifugo protocol heartbeat was not sent")
	}
	if err := <-nativePong; err != nil {
		t.Fatalf("native websocket ping: %v", err)
	}
}

func TestSourceReconnectsWhenHeartbeatIsNotAcknowledged(t *testing.T) {
	var socketConnections atomic.Int32
	var logs bytes.Buffer
	previousLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, nil)))
	defer slog.SetDefault(previousLogger)
	server := newDonationAlertsServer(t, func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/api/v1/user/oauth":
			_, _ = writer.Write([]byte(`{"data":{"id":42,"socket_connection_token":"socket-token"}}`))
		case "/api/v1/centrifuge/subscribe":
			_, _ = writer.Write([]byte(`{"channels":[{"channel":"$alerts:donation_42","token":"channel-token"}]}`))
		}
	}, func(ctx context.Context, connection *websocket.Conn, connectionNumber int32) {
		socketConnections.Store(connectionNumber)
		for {
			command, err := readSocketCommand(ctx, connection)
			if err != nil {
				return
			}
			switch command.Method {
			case methodConnect:
				writeSocketReply(t, ctx, connection, command.ID, map[string]any{"client": testSocketClientID, "version": "2.2.1"})
			case methodSubscribe:
				writeSocketReply(t, ctx, connection, command.ID, map[string]any{"recoverable": true, "recovered": connectionNumber > 1, "epoch": "epoch"})
				if connectionNumber > 1 {
					writeDonation(t, ctx, connection)
				}
			case methodPing:
				if connectionNumber > 1 {
					writeSocketReply(t, ctx, connection, command.ID, struct{}{})
				}
			}
		}
	})
	defer server.Close()

	client := NewClient(server.Client())
	client.BaseURL = server.URL
	source := NewSource(client)
	source.webSocketURL = websocketURL(server.URL)
	source.pingInterval = 20 * time.Millisecond
	source.commandTimeout = 50 * time.Millisecond
	source.retryStart = 10 * time.Millisecond
	source.retryMax = 20 * time.Millisecond
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := source.Run(ctx, "access-token", func(Donation) error {
		cancel()
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if socketConnections.Load() < 2 {
		t.Fatalf("websocket connections = %d; want reconnect after heartbeat timeout", socketConnections.Load())
	}
	if strings.Contains(logs.String(), `"level":"WARN"`) {
		t.Fatalf("routine heartbeat reconnect produced a warning: %s", logs.String())
	}
}

func TestSourceReportsUnknownAndInvalidBatchedPushesAndKeepsListening(t *testing.T) {
	var logs bytes.Buffer
	previousLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, nil)))
	defer slog.SetDefault(previousLogger)
	server := newDonationAlertsServer(t, func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/api/v1/user/oauth":
			_, _ = writer.Write([]byte(`{"data":{"id":42,"socket_connection_token":"socket-token"}}`))
		case "/api/v1/centrifuge/subscribe":
			_, _ = writer.Write([]byte(`{"channels":[{"channel":"$alerts:donation_42","token":"channel-token"}]}`))
		default:
			http.NotFound(writer, request)
		}
	}, func(ctx context.Context, connection *websocket.Conn, _ int32) {
		for {
			command, err := readSocketCommand(ctx, connection)
			if err != nil {
				return
			}
			switch command.Method {
			case methodConnect:
				writeSocketReply(t, ctx, connection, command.ID, map[string]any{"client": testSocketClientID, "version": "2.2.1"})
			case methodSubscribe:
				writeSocketReply(t, ctx, connection, command.ID, map[string]any{"recoverable": true, "epoch": "epoch", "seq": 0, "gen": 0})
				invalidDonation := donationValue(t, 1).(map[string]any)
				invalidDonation["id"] = "not-a-number"
				writeSocketBatch(t, ctx, connection,
					map[string]any{"result": map[string]any{"type": 99, "channel": testChannel, "data": map[string]any{"future": true}}},
					map[string]any{"result": map[string]any{"channel": testChannel, "data": map[string]any{"seq": 1, "gen": 1, "data": invalidDonation}}},
					map[string]any{"result": map[string]any{"type": pushLeave, "channel": testChannel, "data": map[string]any{"info": map[string]any{"user": "42", "client": testSocketClientID}}}},
					map[string]any{"result": map[string]any{"channel": testChannel, "data": publicationValue(t, 2, 2, 1)}},
				)
			case methodPing:
				writeSocketReply(t, ctx, connection, command.ID, struct{}{})
			}
		}
	})
	defer server.Close()

	client := NewClient(server.Client())
	client.BaseURL = server.URL
	source := NewSource(client)
	source.webSocketURL = websocketURL(server.URL)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	var received Donation
	if err := source.Run(ctx, "access-token", func(donation Donation) error {
		received = donation
		cancel()
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if received.SourceDonationID != "2" {
		t.Fatalf("unexpected donation: %#v", received)
	}
	if count := strings.Count(logs.String(), "DonationAlerts websocket message ignored"); count != 2 {
		t.Fatalf("ignored message warnings = %d; logs=%s", count, logs.String())
	}
	for _, detail := range []string{`"type":99`, `future`, `not-a-number`, `rawMessage`} {
		if !strings.Contains(logs.String(), detail) {
			t.Fatalf("warning is missing %q: %s", detail, logs.String())
		}
	}
}

func TestSourceReportsMalformedFrameWithRawMessage(t *testing.T) {
	var logs bytes.Buffer
	previousLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, nil)))
	defer slog.SetDefault(previousLogger)
	server := newDonationAlertsServer(t, func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/api/v1/user/oauth":
			_, _ = writer.Write([]byte(`{"data":{"id":42,"socket_connection_token":"socket-token"}}`))
		case "/api/v1/centrifuge/subscribe":
			_, _ = writer.Write([]byte(`{"channels":[{"channel":"$alerts:donation_42","token":"channel-token"}]}`))
		}
	}, func(ctx context.Context, connection *websocket.Conn, _ int32) {
		for {
			command, err := readSocketCommand(ctx, connection)
			if err != nil {
				return
			}
			switch command.Method {
			case methodConnect:
				writeSocketReply(t, ctx, connection, command.ID, map[string]any{"client": testSocketClientID, "version": "2.2.1"})
			case methodSubscribe:
				writeSocketReply(t, ctx, connection, command.ID, map[string]any{"recoverable": true, "epoch": "epoch"})
				if err := connection.Write(ctx, websocket.MessageText, []byte(`{"result":`)); err != nil {
					t.Errorf("write malformed frame: %v", err)
				}
			}
		}
	})
	defer server.Close()

	client := NewClient(server.Client())
	client.BaseURL = server.URL
	source := NewSource(client)
	source.webSocketURL = websocketURL(server.URL)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	source.wait = func(context.Context, time.Duration) error {
		cancel()
		return context.Canceled
	}
	if err := source.Run(ctx, "access-token", func(Donation) error { return nil }); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(logs.String(), `raw message: {\"result\":`) {
		t.Fatalf("warning does not contain malformed raw frame: %s", logs.String())
	}
}

func TestSourcePropagatesUnauthorizedTokenRefresh(t *testing.T) {
	tests := []struct {
		name                string
		connectionExpires   bool
		subscriptionExpires bool
		unauthorizedPath    string
	}{
		{name: "connection", connectionExpires: true, unauthorizedPath: "/api/v1/user/oauth"},
		{name: "subscription", subscriptionExpires: true, unauthorizedPath: "/api/v1/centrifuge/subscribe"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var profileRequests atomic.Int32
			var channelRequests atomic.Int32
			server := newDonationAlertsServer(t, func(writer http.ResponseWriter, request *http.Request) {
				switch request.URL.Path {
				case "/api/v1/user/oauth":
					requestNumber := profileRequests.Add(1)
					if test.unauthorizedPath == request.URL.Path && requestNumber > 1 {
						writer.WriteHeader(http.StatusUnauthorized)
						return
					}
					_, _ = fmt.Fprintf(writer, `{"data":{"id":42,"socket_connection_token":"socket-token-%d"}}`, requestNumber)
				case "/api/v1/centrifuge/subscribe":
					requestNumber := channelRequests.Add(1)
					if test.unauthorizedPath == request.URL.Path && requestNumber > 1 {
						writer.WriteHeader(http.StatusUnauthorized)
						return
					}
					_, _ = fmt.Fprintf(writer, `{"channels":[{"channel":"$alerts:donation_42","token":"channel-token-%d"}]}`, requestNumber)
				}
			}, func(ctx context.Context, connection *websocket.Conn, _ int32) {
				for {
					command, err := readSocketCommand(ctx, connection)
					if err != nil {
						return
					}
					switch command.Method {
					case methodConnect:
						writeSocketReply(t, ctx, connection, command.ID, map[string]any{
							"client": testSocketClientID, "version": "2.2.1",
							"expires": test.connectionExpires, "ttl": 1,
						})
					case methodSubscribe:
						writeSocketReply(t, ctx, connection, command.ID, map[string]any{
							"recoverable": true, "epoch": "epoch",
							"expires": test.subscriptionExpires, "ttl": 1,
						})
					case methodPing:
						writeSocketReply(t, ctx, connection, command.ID, struct{}{})
					}
				}
			})
			defer server.Close()

			client := NewClient(server.Client())
			client.BaseURL = server.URL
			source := NewSource(client)
			source.webSocketURL = websocketURL(server.URL)
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			err := source.Run(ctx, "access-token", func(Donation) error { return nil })
			var requestError *RequestError
			if !errors.As(err, &requestError) || !requestError.Unauthorized {
				t.Fatalf("error = %v; want unauthorized request error", err)
			}
			if test.connectionExpires && profileRequests.Load() < 2 {
				t.Fatal("connection token was not refreshed")
			}
			if test.subscriptionExpires && channelRequests.Load() < 2 {
				t.Fatal("subscription token was not refreshed")
			}
		})
	}
}

func TestSourcePropagatesUnauthorizedInitialChannelToken(t *testing.T) {
	server := newDonationAlertsServer(t, func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/api/v1/user/oauth":
			_, _ = writer.Write([]byte(`{"data":{"id":42,"socket_connection_token":"socket-token"}}`))
		case "/api/v1/centrifuge/subscribe":
			writer.WriteHeader(http.StatusUnauthorized)
		default:
			http.NotFound(writer, request)
		}
	}, func(ctx context.Context, connection *websocket.Conn, _ int32) {
		command, err := readSocketCommand(ctx, connection)
		if err != nil {
			return
		}
		if command.Method != methodConnect {
			t.Errorf("first command method = %d; want connect", command.Method)
			return
		}
		writeSocketReply(t, ctx, connection, command.ID, map[string]any{"client": testSocketClientID, "version": "2.2.1"})
	})
	defer server.Close()

	client := NewClient(server.Client())
	client.BaseURL = server.URL
	source := NewSource(client)
	source.webSocketURL = websocketURL(server.URL)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	err := source.Run(ctx, "access-token", func(Donation) error { return nil })
	var requestError *RequestError
	if !errors.As(err, &requestError) || !requestError.Unauthorized {
		t.Fatalf("error = %v; want unauthorized request error", err)
	}
}

func TestSourcePropagatesUnauthorizedProfile(t *testing.T) {
	client, closeClient := testClient(t, func(writer http.ResponseWriter, _ *http.Request) { writer.WriteHeader(http.StatusUnauthorized) })
	defer closeClient()
	err := NewSource(client).Run(context.Background(), "access-token", func(Donation) error { return nil })
	var requestError *RequestError
	if !errors.As(err, &requestError) || !requestError.Unauthorized {
		t.Fatalf("error = %v", err)
	}
}

func TestSourceUsesExponentialBackoffBeforeSubscription(t *testing.T) {
	client, closeClient := testClient(t, func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = writer.Write([]byte(`{"data":{"id":42}}`))
	})
	defer closeClient()
	source := NewSource(client)
	ctx, cancel := context.WithCancel(context.Background())
	waits := make([]time.Duration, 0, 4)
	source.wait = func(_ context.Context, duration time.Duration) error {
		waits = append(waits, duration)
		if len(waits) == 4 {
			cancel()
			return context.Canceled
		}
		return nil
	}
	if err := source.Run(ctx, "access-token", func(Donation) error { return nil }); err != nil {
		t.Fatal(err)
	}
	want := []time.Duration{5 * time.Second, 10 * time.Second, 20 * time.Second, 40 * time.Second}
	if !reflect.DeepEqual(waits, want) {
		t.Fatalf("backoff = %v; want %v", waits, want)
	}
}

func TestSourceCancelsPendingReconnect(t *testing.T) {
	client, closeClient := testClient(t, func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = writer.Write([]byte(`{"data":{"id":42}}`))
	})
	defer closeClient()
	source := NewSource(client)
	source.retryStart = time.Hour
	waiting := make(chan struct{})
	source.wait = func(ctx context.Context, _ time.Duration) error {
		close(waiting)
		<-ctx.Done()
		return ctx.Err()
	}
	ctx, cancel := context.WithCancel(context.Background())
	finished := make(chan error, 1)
	go func() { finished <- source.Run(ctx, "access-token", func(Donation) error { return nil }) }()
	select {
	case <-waiting:
	case <-time.After(time.Second):
		t.Fatal("source did not enter reconnect wait")
	}
	cancel()
	select {
	case err := <-finished:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("pending reconnect did not stop after cancellation")
	}
}

func TestSourceDoesNotRequestProfileWhenAlreadyCancelled(t *testing.T) {
	client, closeClient := testClient(t, func(http.ResponseWriter, *http.Request) { t.Fatal("unexpected profile request") })
	defer closeClient()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := NewSource(client).Run(ctx, "access-token", func(Donation) error { return nil }); err != nil {
		t.Fatal(err)
	}
}

func TestSourceCancelsEstablishedSession(t *testing.T) {
	subscribed := make(chan struct{}, 1)
	server := newDonationAlertsServer(t, func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/api/v1/user/oauth":
			_, _ = writer.Write([]byte(`{"data":{"id":42,"socket_connection_token":"socket-token"}}`))
		case "/api/v1/centrifuge/subscribe":
			_, _ = writer.Write([]byte(`{"channels":[{"channel":"$alerts:donation_42","token":"channel-token"}]}`))
		}
	}, func(ctx context.Context, connection *websocket.Conn, _ int32) {
		for {
			command, err := readSocketCommand(ctx, connection)
			if err != nil {
				return
			}
			switch command.Method {
			case methodConnect:
				writeSocketReply(t, ctx, connection, command.ID, map[string]any{"client": testSocketClientID, "version": "2.2.1"})
			case methodSubscribe:
				writeSocketReply(t, ctx, connection, command.ID, map[string]any{"recoverable": true, "epoch": "epoch"})
				subscribed <- struct{}{}
			case methodPing:
				writeSocketReply(t, ctx, connection, command.ID, struct{}{})
			}
		}
	})
	defer server.Close()

	client := NewClient(server.Client())
	client.BaseURL = server.URL
	source := NewSource(client)
	source.webSocketURL = websocketURL(server.URL)
	ctx, cancel := context.WithCancel(context.Background())
	finished := make(chan error, 1)
	go func() { finished <- source.Run(ctx, "access-token", func(Donation) error { return nil }) }()
	select {
	case <-subscribed:
	case <-time.After(time.Second):
		t.Fatal("subscription was not established")
	}
	cancel()
	select {
	case err := <-finished:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("established session did not stop after cancellation")
	}
}

func TestSourceSupportsConcurrentRuns(t *testing.T) {
	var connectionNumber atomic.Int32
	server := newDonationAlertsServer(t, func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/api/v1/user/oauth":
			_, _ = writer.Write([]byte(`{"data":{"id":42,"socket_connection_token":"socket-token"}}`))
		case "/api/v1/centrifuge/subscribe":
			_, _ = writer.Write([]byte(`{"channels":[{"channel":"$alerts:donation_42","token":"channel-token"}]}`))
		}
	}, func(ctx context.Context, connection *websocket.Conn, _ int32) {
		id := int(connectionNumber.Add(1))
		for {
			command, err := readSocketCommand(ctx, connection)
			if err != nil {
				return
			}
			switch command.Method {
			case methodConnect:
				writeSocketReply(t, ctx, connection, command.ID, map[string]any{"client": testSocketClientID, "version": "2.2.1"})
			case methodSubscribe:
				writeSocketReply(t, ctx, connection, command.ID, map[string]any{"recoverable": true, "epoch": "epoch"})
				writeDonationWithPosition(t, ctx, connection, id, id, 1)
			case methodPing:
				writeSocketReply(t, ctx, connection, command.ID, struct{}{})
			}
		}
	})
	defer server.Close()

	client := NewClient(server.Client())
	client.BaseURL = server.URL
	source := NewSource(client)
	source.webSocketURL = websocketURL(server.URL)
	finished := make(chan error, 2)
	for range 2 {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		go func() {
			finished <- source.Run(ctx, "access-token", func(Donation) error {
				cancel()
				return nil
			})
		}()
	}
	for range 2 {
		if err := <-finished; err != nil {
			t.Fatal(err)
		}
	}
	if connectionNumber.Load() != 2 {
		t.Fatalf("websocket connections = %d; want 2 independent sessions", connectionNumber.Load())
	}
}

func TestSocketSessionDoesNotAdvancePositionAfterPersistenceFailure(t *testing.T) {
	wantErr := errors.New("database unavailable")
	session := socketSession{onPublication: func([]byte) error { return wantErr }}
	result := sessionResult{position: streamPosition{epoch: "epoch", sequence: 7, generation: 1, valid: true}}
	err := session.emitPublication(context.Background(), socketPublication{Sequence: 8, Generation: 1, Data: []byte(testDonation)}, []byte(`{"raw":true}`), &result)
	if !errors.Is(err, wantErr) {
		t.Fatalf("error = %v; want persistence failure", err)
	}
	if result.position.sequence != 7 || result.position.generation != 1 {
		t.Fatalf("position advanced after failed persistence: %+v", result.position)
	}
}

func TestClassifySocketReadErrorHonorsReconnectAdvice(t *testing.T) {
	tests := []struct {
		name          string
		reason        string
		wantTransport bool
		wantDetail    string
	}{
		{name: "reconnect", reason: `{"reason":"server restart","reconnect":true}`, wantTransport: true, wantDetail: "server restart"},
		{name: "terminal", reason: `{"reason":"invalid token","reconnect":false}`, wantDetail: "invalid token"},
		{name: "unstructured", reason: "service unavailable", wantTransport: true, wantDetail: "service unavailable"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := classifySocketReadError(websocket.CloseError{Code: websocket.StatusCode(3001), Reason: test.reason})
			if isTransportError(err) != test.wantTransport {
				t.Fatalf("transport error = %t; want %t; error=%v", isTransportError(err), test.wantTransport, err)
			}
			if !strings.Contains(err.Error(), test.wantDetail) {
				t.Fatalf("error %q is missing %q", err, test.wantDetail)
			}
		})
	}
}

func newDonationAlertsServer(t *testing.T, apiHandler http.HandlerFunc, socketHandler func(context.Context, *websocket.Conn, int32)) *httptest.Server {
	t.Helper()
	var connectionNumber atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/connection/websocket" {
			apiHandler(writer, request)
			return
		}
		connection, err := websocket.Accept(writer, request, nil)
		if err != nil {
			t.Errorf("upgrade websocket: %v", err)
			return
		}
		defer connection.CloseNow()
		socketHandler(context.Background(), connection, connectionNumber.Add(1))
	}))
	return server
}

func readSocketCommand(ctx context.Context, connection *websocket.Conn) (receivedCommand, error) {
	command, _, err := readSocketMessage(ctx, connection)
	return command, err
}

func readSocketMessage(ctx context.Context, connection *websocket.Conn) (receivedCommand, []byte, error) {
	_, body, err := connection.Read(ctx)
	if err != nil {
		return receivedCommand{}, nil, err
	}
	var command receivedCommand
	err = json.Unmarshal(body, &command)
	return command, body, err
}

func writeSocketReply(t *testing.T, ctx context.Context, connection *websocket.Conn, id uint64, result any) {
	t.Helper()
	writeSocketValue(t, ctx, connection, map[string]any{"id": id, "result": result})
}

func writeDonation(t *testing.T, ctx context.Context, connection *websocket.Conn) {
	t.Helper()
	writeSocketValue(t, ctx, connection, map[string]any{
		"result": map[string]any{
			"channel": testChannel,
			"data":    publicationValue(t, 1, 0, 0),
		},
	})
}

func writeDonationWithPosition(t *testing.T, ctx context.Context, connection *websocket.Conn, id, sequence, generation int) {
	t.Helper()
	writeSocketValue(t, ctx, connection, map[string]any{
		"result": map[string]any{
			"channel": testChannel,
			"data":    publicationValue(t, id, sequence, generation),
		},
	})
}

func publicationValue(t *testing.T, id, sequence, generation int) map[string]any {
	t.Helper()
	donation := donationValue(t, id)
	return map[string]any{"seq": sequence, "gen": generation, "data": donation}
}

func donationValue(t *testing.T, id int) any {
	t.Helper()
	var donation map[string]any
	if err := json.Unmarshal([]byte(testDonation), &donation); err != nil {
		t.Fatal(err)
	}
	donation["id"] = id
	return donation
}

func writeSocketLeave(t *testing.T, ctx context.Context, connection *websocket.Conn) {
	t.Helper()
	writeSocketValue(t, ctx, connection, map[string]any{
		"result": map[string]any{
			"type":    2,
			"channel": testChannel,
			"data": map[string]any{
				"info": map[string]any{"user": "42", "client": testSocketClientID},
			},
		},
	})
}

func writeSocketValue(t *testing.T, ctx context.Context, connection *websocket.Conn, value any) {
	t.Helper()
	body, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if err := connection.Write(ctx, websocket.MessageText, body); err != nil {
		t.Errorf("write websocket message: %v", err)
	}
}

func writeSocketBatch(t *testing.T, ctx context.Context, connection *websocket.Conn, values ...any) {
	t.Helper()
	messages := make([][]byte, 0, len(values))
	for _, value := range values {
		body, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		messages = append(messages, body)
	}
	if err := connection.Write(ctx, websocket.MessageText, bytes.Join(messages, []byte{'\n'})); err != nil {
		t.Errorf("write websocket batch: %v", err)
	}
}

func websocketURL(serverURL string) string {
	return "ws" + strings.TrimPrefix(serverURL, "http") + "/connection/websocket"
}
