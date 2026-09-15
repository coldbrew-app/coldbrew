package streamelements

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
)

const (
	testRequestedRoom = "requested-channel-room"
	testAccessToken   = "secret-access-token"
	testReconnect     = "secret-reconnect-token"
)

type socketRead struct {
	body []byte
	err  error
}

type fakeSocket struct {
	reads chan socketRead

	mu       sync.Mutex
	writes   [][]byte
	writeErr error
	closed   int
}

func newFakeSocket(reads ...socketRead) *fakeSocket {
	socket := &fakeSocket{reads: make(chan socketRead, len(reads))}
	for _, read := range reads {
		socket.reads <- read
	}
	return socket
}

func (socket *fakeSocket) Read(ctx context.Context) ([]byte, error) {
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case read := <-socket.reads:
		return read.body, read.err
	}
}

func (socket *fakeSocket) Write(_ context.Context, body []byte) error {
	socket.mu.Lock()
	defer socket.mu.Unlock()
	socket.writes = append(socket.writes, append([]byte(nil), body...))
	return socket.writeErr
}

func (socket *fakeSocket) Close() error {
	socket.mu.Lock()
	defer socket.mu.Unlock()
	socket.closed++
	return nil
}

func (socket *fakeSocket) written() [][]byte {
	socket.mu.Lock()
	defer socket.mu.Unlock()
	result := make([][]byte, len(socket.writes))
	for index, body := range socket.writes {
		result[index] = append([]byte(nil), body...)
	}
	return result
}

func TestSourceSubscribesAndEmitsFullTipUsingCanonicalRoom(t *testing.T) {
	canonicalRoom := testChannelID
	socket := newFakeSocket(
		jsonRead(`{"id":"welcome-id","ts":"2025-02-19T15:07:00Z","type":"welcome","data":{"message":"welcome","client_id":"client-id"}}`),
		jsonRead(`{"id":"response-id","ts":"2025-02-19T15:07:01Z","type":"response","nonce":"test-nonce","data":{"message":"successfully subscribed to topic","topic":"channel.tips","room":"`+canonicalRoom+`"}}`),
		jsonRead(astroTipJSON(canonicalRoom, completedTipJSON(
			"67b5f39d07ecd4c594e60f73",
			"4.2",
			"usd",
			"2025-02-19T15:07:09.302Z",
			"Styler",
			"Thank you",
		))),
	)
	source := testSource(socket)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var received Donation
	err := source.Run(ctx, testAccessToken, testRequestedRoom, func(donation Donation) error {
		received = donation
		cancel()
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	writes := socket.written()
	if len(writes) != 1 {
		t.Fatalf("writes = %q; want one subscription", writes)
	}
	var subscription astroSubscribe
	if err := json.Unmarshal(writes[0], &subscription); err != nil {
		t.Fatal(err)
	}
	wantSubscription := astroSubscribe{
		Type:  "subscribe",
		Nonce: "test-nonce",
		Data: astroSubscription{
			Topic:     "channel.tips",
			Room:      testRequestedRoom,
			Token:     testAccessToken,
			TokenType: "oauth2",
		},
	}
	if !reflect.DeepEqual(subscription, wantSubscription) {
		t.Fatalf("subscription = %#v; want %#v", subscription, wantSubscription)
	}
	if received.SourceDonationID != "67b5f39d07ecd4c594e60f73" || received.Amount != "4.20" ||
		received.Currency != "USD" || received.SourceCreatedAt != "2025-02-19T15:07:09.302Z" ||
		!received.OccurredAt.Equal(time.Date(2025, 2, 19, 15, 7, 9, 302_000_000, time.UTC)) ||
		received.Author == nil || *received.Author != "Styler" || received.Message == nil || *received.Message != "Thank you" {
		t.Fatalf("donation = %#v", received)
	}
	if socket.closed != 1 {
		t.Fatalf("socket close count = %d", socket.closed)
	}
}

func TestSourceIgnoresUnrelatedMessagesAndDoesNotFilterTipStateFields(t *testing.T) {
	tip := completedTipMap("blocked-tip", "7.5", "EUR", "2025-02-19T15:00:00Z")
	tip["status"] = "blocked"
	tip["approved"] = "denied"
	tip["deleted"] = true
	tipBody, err := json.Marshal(tip)
	if err != nil {
		t.Fatal(err)
	}
	socket := newFakeSocket(
		jsonRead(`{"type":"unrelated","data":{}}`),
		jsonRead(`{"type":"welcome","data":{"client_id":"client-id"}}`),
		jsonRead(`{"type":"response","nonce":"another-nonce","data":{"topic":"channel.tips","room":"`+testChannelID+`"}}`),
		jsonRead(`{"type":"message","topic":"channel.followers","room":"`+testChannelID+`","data":{}}`),
		jsonRead(`{"type":"response","nonce":"test-nonce","data":{"topic":"channel.tips","room":"`+testChannelID+`"}}`),
		jsonRead(astroTipJSON("another-room", string(tipBody))),
		jsonRead(astroTipJSON(testChannelID, string(tipBody))),
	)
	source := testSource(socket)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var received []Donation
	if err := source.Run(ctx, testAccessToken, testChannelID, func(donation Donation) error {
		received = append(received, donation)
		cancel()
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if len(received) != 1 || received[0].SourceDonationID != "blocked-tip" || received[0].Amount != "7.50" {
		t.Fatalf("donations = %#v", received)
	}
}

func TestSourceReturnsUnauthorizedSubscribeErrorWithoutRetry(t *testing.T) {
	socket := newFakeSocket(
		jsonRead(`{"type":"welcome","data":{"client_id":"client-id"}}`),
		jsonRead(`{"type":"response","nonce":"test-nonce","error":"err_unauthorized","data":{"message":"`+testAccessToken+` must never be logged"}}`),
	)
	source := testSource(socket)
	source.wait = func(context.Context, time.Duration) error {
		t.Fatal("unauthorized listener unexpectedly retried")
		return nil
	}
	err := source.Run(context.Background(), testAccessToken, testChannelID, func(Donation) error {
		t.Fatal("unexpected donation")
		return nil
	})
	var requestError *RequestError
	if !errors.As(err, &requestError) || !requestError.Unauthorized {
		t.Fatalf("error = %v; want unauthorized RequestError", err)
	}
	if strings.Contains(err.Error(), testAccessToken) {
		t.Fatalf("error leaked access token: %v", err)
	}
}

func TestSourceReturnsUnauthorizedHandshakeWithoutRetry(t *testing.T) {
	source := NewSource()
	var dials atomic.Int32
	source.dial = func(context.Context, string) (Socket, error) {
		dials.Add(1)
		return nil, &RequestError{
			Unauthorized: true,
			Status:       http.StatusUnauthorized,
			Operation:    "open Astro websocket",
		}
	}
	source.wait = func(context.Context, time.Duration) error {
		t.Fatal("unauthorized listener unexpectedly retried")
		return nil
	}
	err := source.Run(context.Background(), testAccessToken, testChannelID, func(Donation) error { return nil })
	var requestError *RequestError
	if !errors.As(err, &requestError) || !requestError.Unauthorized || dials.Load() != 1 {
		t.Fatalf("error = %v after %d dials", err, dials.Load())
	}
}

func TestDialSocketClassifiesHTTP401(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()

	_, err := dialSocket(context.Background(), websocketURL(server.URL))
	var requestError *RequestError
	if !errors.As(err, &requestError) || !requestError.Unauthorized || requestError.Status != http.StatusUnauthorized {
		t.Fatalf("error = %v; want HTTP 401 RequestError", err)
	}
}

func TestSourceUsesExponentialBackoffForSubscriptionFailures(t *testing.T) {
	source := NewSource()
	source.nonce = func() (string, error) { return "test-nonce", nil }
	source.jitter = func(delay time.Duration) time.Duration { return delay }
	var dials int
	source.dial = func(context.Context, string) (Socket, error) {
		dials++
		return newFakeSocket(
			jsonRead(`{"type":"welcome","data":{"client_id":"client-id"}}`),
			jsonRead(`{"type":"response","error":"rate_limit_exceeded","data":{"message":"slow down"}}`),
		), nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	waits := make([]time.Duration, 0, 3)
	source.wait = func(_ context.Context, delay time.Duration) error {
		waits = append(waits, delay)
		if len(waits) == 3 {
			cancel()
			return context.Canceled
		}
		return nil
	}
	if err := source.Run(ctx, testAccessToken, testChannelID, func(Donation) error { return nil }); err != nil {
		t.Fatal(err)
	}
	want := []time.Duration{5 * time.Second, 10 * time.Second, 20 * time.Second}
	if dials != 3 || !reflect.DeepEqual(waits, want) {
		t.Fatalf("dials=%d waits=%v; want dials=3 waits=%v", dials, waits, want)
	}
}

func TestSourceResetsBackoffAfterSuccessfulSubscription(t *testing.T) {
	source := NewSource()
	source.nonce = func() (string, error) { return "test-nonce", nil }
	source.jitter = func(delay time.Duration) time.Duration { return delay }
	dials := 0
	source.dial = func(context.Context, string) (Socket, error) {
		dials++
		if dials == 1 {
			return nil, errors.New("offline")
		}
		return newFakeSocket(
			jsonRead(`{"type":"welcome","data":{"client_id":"client-id"}}`),
			jsonRead(`{"type":"response","nonce":"test-nonce","data":{"topic":"channel.tips","room":"`+testChannelID+`"}}`),
			socketRead{err: errors.New("connection reset")},
		), nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	waits := make([]time.Duration, 0, 2)
	source.wait = func(_ context.Context, delay time.Duration) error {
		waits = append(waits, delay)
		if len(waits) == 2 {
			cancel()
			return context.Canceled
		}
		return nil
	}
	if err := source.Run(ctx, testAccessToken, testChannelID, func(Donation) error { return nil }); err != nil {
		t.Fatal(err)
	}
	want := []time.Duration{5 * time.Second, 5 * time.Second}
	if !reflect.DeepEqual(waits, want) {
		t.Fatalf("waits = %v; want %v", waits, want)
	}
}

func TestSourceUsesReconnectTokenWithoutResubscribing(t *testing.T) {
	first := newFakeSocket(
		jsonRead(`{"type":"welcome","data":{"client_id":"client-id-1"}}`),
		jsonRead(`{"type":"response","nonce":"test-nonce","data":{"topic":"channel.tips","room":"`+testChannelID+`"}}`),
		jsonRead(`{"type":"reconnect","data":{"message":"server restart","reconnect_token":"`+testReconnect+`"}}`),
	)
	second := newFakeSocket(
		jsonRead(`{"type":"welcome","data":{"client_id":"client-id-2"}}`),
		jsonRead(astroTipJSON(testChannelID, completedTipJSON("after-reconnect", "10", "USD", "2025-02-19T15:00:00Z", "Tipper", ""))),
	)
	source := NewSource()
	source.nonce = func() (string, error) { return "test-nonce", nil }
	source.wait = func(context.Context, time.Duration) error {
		t.Fatal("graceful reconnect unexpectedly waited")
		return nil
	}
	dialedURLs := make([]string, 0, 2)
	source.dial = func(_ context.Context, rawURL string) (Socket, error) {
		dialedURLs = append(dialedURLs, rawURL)
		if len(dialedURLs) == 1 {
			return first, nil
		}
		return second, nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	if err := source.Run(ctx, testAccessToken, testRequestedRoom, func(donation Donation) error {
		if donation.SourceDonationID != "after-reconnect" {
			t.Fatalf("donation = %#v", donation)
		}
		cancel()
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if len(dialedURLs) != 2 {
		t.Fatalf("dialed URLs = %v", dialedURLs)
	}
	firstURL, err := url.Parse(dialedURLs[0])
	if err != nil {
		t.Fatal(err)
	}
	secondURL, err := url.Parse(dialedURLs[1])
	if err != nil {
		t.Fatal(err)
	}
	if firstURL.Query().Has("reconnect_token") || secondURL.Query().Get("reconnect_token") != testReconnect {
		t.Fatalf("dialed URLs = %v", dialedURLs)
	}
	if strings.Contains(strings.Join(dialedURLs, " "), testAccessToken) {
		t.Fatalf("access token leaked into websocket URL: %v", dialedURLs)
	}
	if len(first.written()) != 1 || len(second.written()) != 0 {
		t.Fatalf("subscription writes before=%q after=%q", first.written(), second.written())
	}
}

func TestSourceDiscardsFailedReconnectTokenAndDoesNotLogSecrets(t *testing.T) {
	first := newFakeSocket(
		jsonRead(`{"type":"welcome","data":{"client_id":"client-id-1"}}`),
		jsonRead(`{"type":"response","nonce":"test-nonce","data":{"topic":"channel.tips","room":"`+testChannelID+`"}}`),
		jsonRead(`{"type":"reconnect","data":{"reconnect_token":"`+testReconnect+`"}}`),
	)
	third := newFakeSocket(
		jsonRead(`{"type":"welcome","data":{"client_id":"client-id-3"}}`),
		jsonRead(`{"type":"response","nonce":"test-nonce","data":{"topic":"channel.tips","room":"`+testChannelID+`"}}`),
		jsonRead(astroTipJSON(testChannelID, completedTipJSON("fallback-tip", "1", "USD", "2025-02-19T15:00:00Z", "Tipper", ""))),
	)
	var logs bytes.Buffer
	previousLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, nil)))
	defer slog.SetDefault(previousLogger)

	source := NewSource()
	source.nonce = func() (string, error) { return "test-nonce", nil }
	source.jitter = func(delay time.Duration) time.Duration { return delay }
	source.wait = func(context.Context, time.Duration) error { return nil }
	dialedURLs := make([]string, 0, 3)
	source.dial = func(_ context.Context, rawURL string) (Socket, error) {
		dialedURLs = append(dialedURLs, rawURL)
		switch len(dialedURLs) {
		case 1:
			return first, nil
		case 2:
			return nil, fmt.Errorf("dial of %s with %s failed", rawURL, testAccessToken)
		default:
			return third, nil
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	if err := source.Run(ctx, testAccessToken, testRequestedRoom, func(Donation) error {
		cancel()
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if len(dialedURLs) != 3 {
		t.Fatalf("dialed URLs = %v", dialedURLs)
	}
	secondURL, _ := url.Parse(dialedURLs[1])
	thirdURL, _ := url.Parse(dialedURLs[2])
	if secondURL.Query().Get("reconnect_token") != testReconnect || thirdURL.Query().Has("reconnect_token") {
		t.Fatalf("dialed URLs = %v", dialedURLs)
	}
	for _, secret := range []string{testAccessToken, testReconnect} {
		if strings.Contains(logs.String(), secret) {
			t.Fatalf("logs leaked %q: %s", secret, logs.String())
		}
	}
}

func TestSourceReturnsValidationErrorsForMalformedProtocolMessages(t *testing.T) {
	tests := []struct {
		name  string
		reads []socketRead
	}{
		{name: "invalid JSON", reads: []socketRead{jsonRead(`not-json`)}},
		{name: "missing type", reads: []socketRead{jsonRead(`{"data":{}}`)}},
		{name: "invalid welcome", reads: []socketRead{jsonRead(`{"type":"welcome","data":{}}`)}},
		{name: "message before subscription", reads: []socketRead{jsonRead(`{"type":"message","topic":"channel.tips","room":"` + testChannelID + `","data":{}}`)}},
		{name: "empty reconnect token", reads: []socketRead{jsonRead(`{"type":"reconnect","data":{}}`)}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			source := testSource(newFakeSocket(test.reads...))
			_, err := source.runSession(context.Background(), "wss://astro.test", testAccessToken, testChannelID, false, func(Donation) error { return nil })
			if err == nil {
				t.Fatal("expected protocol validation error")
			}
		})
	}
}

func TestSourcePropagatesTipAndEmitterErrors(t *testing.T) {
	emitError := errors.New("store unavailable")
	tests := []struct {
		name    string
		tipJSON string
		emit    func(Donation) error
	}{
		{name: "invalid tip", tipJSON: completedTipJSON("tip", "1.234", "USD", "2025-02-19T15:00:00Z", "Tipper", ""), emit: func(Donation) error { return nil }},
		{name: "emitter", tipJSON: completedTipJSON("tip", "1", "USD", "2025-02-19T15:00:00Z", "Tipper", ""), emit: func(Donation) error { return emitError }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			socket := newFakeSocket(
				jsonRead(`{"type":"welcome","data":{"client_id":"client-id"}}`),
				jsonRead(`{"type":"response","nonce":"test-nonce","data":{"topic":"channel.tips","room":"`+testChannelID+`"}}`),
				jsonRead(astroTipJSON(testChannelID, test.tipJSON)),
			)
			source := testSource(socket)
			_, err := source.runSession(context.Background(), "wss://astro.test", testAccessToken, testChannelID, false, test.emit)
			if err == nil {
				t.Fatal("expected error")
			}
			if test.name == "emitter" && !errors.Is(err, emitError) {
				t.Fatalf("error = %v; want emitter error", err)
			}
		})
	}
}

func TestCoderWebsocketAdapterAnswersNativePing(t *testing.T) {
	pingResult := make(chan error, 1)
	serverDone := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		defer close(serverDone)
		connection, err := websocket.Accept(writer, request, nil)
		if err != nil {
			t.Errorf("accept websocket: %v", err)
			return
		}
		defer func() { _ = connection.CloseNow() }()
		ctx, cancel := context.WithTimeout(request.Context(), 2*time.Second)
		defer cancel()
		writeWebsocketJSON(t, ctx, connection, `{"type":"welcome","data":{"client_id":"client-id"}}`)
		_, subscriptionBody, err := connection.Read(ctx)
		if err != nil {
			t.Errorf("read subscription: %v", err)
			return
		}
		var subscription astroSubscribe
		if err := json.Unmarshal(subscriptionBody, &subscription); err != nil {
			t.Errorf("decode subscription: %v", err)
			return
		}
		writeWebsocketJSON(t, ctx, connection, `{"type":"response","nonce":"`+subscription.Nonce+`","data":{"topic":"channel.tips","room":"`+testChannelID+`"}}`)

		readerDone := make(chan error, 1)
		go func() {
			_, _, readErr := connection.Read(ctx)
			readerDone <- readErr
		}()
		pingErr := connection.Ping(ctx)
		pingResult <- pingErr
		if pingErr != nil {
			return
		}
		writeWebsocketJSON(t, ctx, connection, astroTipJSON(testChannelID, completedTipJSON("ping-tip", "2", "USD", "2025-02-19T15:00:00Z", "Tipper", "")))
		<-readerDone
	}))
	defer server.Close()

	source := NewSource()
	source.socketURL = websocketURL(server.URL)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := source.Run(ctx, testAccessToken, testChannelID, func(Donation) error {
		cancel()
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := <-pingResult; err != nil {
		t.Fatalf("native websocket ping: %v", err)
	}
	select {
	case <-serverDone:
	case <-time.After(time.Second):
		t.Fatal("websocket server did not finish")
	}
}

func TestAstroResponseErrorClassification(t *testing.T) {
	for _, code := range []string{"err_internal_error", "err_bad_request", "err_deadline_exceeded", "rate_limit_exceeded", "invalid_message_type", "future_error"} {
		err := astroResponseError(code)
		var requestError *RequestError
		if !errors.As(err, &requestError) || requestError.Unauthorized {
			t.Fatalf("code %q error = %v; want retryable RequestError", code, err)
		}
	}
	err := astroResponseError("err_unauthorized")
	var requestError *RequestError
	if !errors.As(err, &requestError) || !requestError.Unauthorized {
		t.Fatalf("unauthorized error = %v", err)
	}
}

func TestAstroSocketURLAndNonce(t *testing.T) {
	rawURL, err := astroSocketURL("wss://astro.test/socket?existing=value", "token with + symbols")
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := url.Parse(rawURL)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Query().Get("existing") != "value" || parsed.Query().Get("reconnect_token") != "token with + symbols" {
		t.Fatalf("socket URL = %s", rawURL)
	}
	if _, invalidErr := astroSocketURL("://invalid", "token"); invalidErr == nil {
		t.Fatal("invalid socket URL was accepted")
	}
	nonce, err := subscriptionNonce()
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := hex.DecodeString(nonce)
	if err != nil || len(decoded) != 16 {
		t.Fatalf("nonce = %q decoded length=%d error=%v", nonce, len(decoded), err)
	}
}

func TestJitterDelayStaysWithinConfiguredRange(t *testing.T) {
	base := 10 * time.Second
	for range 100 {
		delay := jitterDelay(base)
		if delay < 8*time.Second || delay > 12*time.Second {
			t.Fatalf("jitter delay = %s", delay)
		}
	}
}

func testSource(socket Socket) *Source {
	source := NewSource()
	source.dial = func(context.Context, string) (Socket, error) { return socket, nil }
	source.nonce = func() (string, error) { return "test-nonce", nil }
	source.wait = func(context.Context, time.Duration) error { return errors.New("unexpected retry") }
	return source
}

func jsonRead(body string) socketRead { return socketRead{body: []byte(body)} }

func astroTipJSON(room, tipJSON string) string {
	return `{"id":"message-id","ts":"2025-02-19T15:07:17Z","type":"message","topic":"channel.tips","room":"` + room + `","data":` + tipJSON + `}`
}

func websocketURL(httpURL string) string {
	return "ws" + strings.TrimPrefix(httpURL, "http")
}

func writeWebsocketJSON(t *testing.T, ctx context.Context, connection *websocket.Conn, body string) {
	t.Helper()
	if err := connection.Write(ctx, websocket.MessageText, []byte(body)); err != nil {
		t.Errorf("write websocket message: %v", err)
	}
}
