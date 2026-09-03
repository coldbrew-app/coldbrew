package donationalerts

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"reflect"
	"sync"
	"testing"
	"time"
)

type fakeSocket struct {
	reads  chan []byte
	mu     sync.Mutex
	writes [][]byte
	closed int
}

type failingSocket struct {
	err    error
	closed chan struct{}
}

func (socket *failingSocket) Read(context.Context) ([]byte, error) { return nil, socket.err }
func (*failingSocket) Write(context.Context, []byte) error         { return nil }
func (socket *failingSocket) Close() error {
	select {
	case <-socket.closed:
	default:
		close(socket.closed)
	}
	return nil
}

func (socket *fakeSocket) Read(ctx context.Context) ([]byte, error) {
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case body := <-socket.reads:
		return body, nil
	}
}

func (socket *fakeSocket) Write(_ context.Context, body []byte) error {
	socket.mu.Lock()
	defer socket.mu.Unlock()
	socket.writes = append(socket.writes, append([]byte(nil), body...))
	return nil
}

func (socket *fakeSocket) Close() error {
	socket.mu.Lock()
	defer socket.mu.Unlock()
	socket.closed++
	return nil
}

func TestSourceAuthorizesSubscribesAndEmitsDonation(t *testing.T) {
	client, closeClient := testClient(t, func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/v1/centrifuge/subscribe" || request.Header.Get("Authorization") != "Bearer access-token" || request.Header.Get("Content-Type") != "application/json" {
			t.Fatalf("unexpected channel request: %s headers=%v", request.URL, request.Header)
		}
		_, _ = writer.Write([]byte(`{"channels":[{"channel":"$alerts:donation_42","token":"channel-token"}]}`))
	})
	defer closeClient()
	socket := &fakeSocket{reads: make(chan []byte, 2)}
	socket.reads <- []byte(`{"id":1,"result":{"client":"d558c046-c679-43e3-a62d-65989ab55f7c","version":"2.2.1"}}`)
	socket.reads <- []byte(`{"result":{"channel":"$alerts:donation_42","data":{"data":{"id":1,"username":"Streamer","message":"Thank you","amount":"10.00","currency":"USD","created_at":"2026-08-22 12:00:00"}}}}`)
	source := NewSource(client)
	source.dial = func(context.Context, string) (Socket, error) { return socket, nil }
	ctx, cancel := context.WithCancel(context.Background())
	var received Donation
	emitted, err := source.runSession(ctx, "access-token", SocketProfile{UserID: "42", SocketConnectionToken: "socket-token"}, func(donation Donation) error {
		received = donation
		cancel()
		return nil
	})
	if err != nil || !emitted {
		t.Fatalf("runSession() emitted=%v err=%v", emitted, err)
	}
	if received.SourceDonationID != "1" || received.Amount != "10.00" {
		t.Fatalf("unexpected donation: %#v", received)
	}
	if socket.closed != 1 || len(socket.writes) != 2 {
		t.Fatalf("socket closed=%d writes=%d", socket.closed, len(socket.writes))
	}
	var authorization, subscription map[string]any
	if err := json.Unmarshal(socket.writes[0], &authorization); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(socket.writes[1], &subscription); err != nil {
		t.Fatal(err)
	}
	if authorization["id"] != float64(1) || subscription["method"] != float64(1) {
		t.Fatalf("unexpected websocket writes: %#v %#v", authorization, subscription)
	}
}

func TestSourcePropagatesUnauthorizedChannelToken(t *testing.T) {
	client, closeClient := testClient(t, func(writer http.ResponseWriter, _ *http.Request) { writer.WriteHeader(http.StatusUnauthorized) })
	defer closeClient()
	socket := &fakeSocket{reads: make(chan []byte, 1)}
	socket.reads <- []byte(`{"id":1,"result":{"client":"d558c046-c679-43e3-a62d-65989ab55f7c","version":"2.2.1"}}`)
	source := NewSource(client)
	source.dial = func(context.Context, string) (Socket, error) { return socket, nil }
	_, err := source.runSession(context.Background(), "access-token", SocketProfile{UserID: "42", SocketConnectionToken: "socket-token"}, func(Donation) error { return nil })
	var requestError *RequestError
	if !errors.As(err, &requestError) || !requestError.Unauthorized || socket.closed != 1 {
		t.Fatalf("expected unauthorized and closed socket, got err=%v closed=%d", err, socket.closed)
	}
}

func TestSourceRejectsUnknownMessage(t *testing.T) {
	client, closeClient := testClient(t, func(http.ResponseWriter, *http.Request) {})
	defer closeClient()
	socket := &fakeSocket{reads: make(chan []byte, 1)}
	socket.reads <- []byte(`{"result":{}}`)
	source := NewSource(client)
	source.dial = func(context.Context, string) (Socket, error) { return socket, nil }
	_, err := source.runSession(context.Background(), "access-token", SocketProfile{UserID: "42", SocketConnectionToken: "socket-token"}, func(Donation) error { return nil })
	if err == nil || err.Error() != "invalid DonationAlerts websocket message" {
		t.Fatalf("expected invalid message error, got %v", err)
	}
}

func TestDecodeSocketEventRequiresCompleteControlFrames(t *testing.T) {
	invalid := []string{
		`{"id":1,"result":{"client":"not-a-uuid","version":"2.2.1"}}`,
		`{"id":1,"result":{"client":"d558c046-c679-43e3-a62d-65989ab55f7c"}}`,
		`{"id":2,"result":{"recoverable":true}}`,
		`{"result":{"type":1,"channel":"$alerts:donation_42","data":{"info":{"user":"42","client":"not-a-uuid"}}}}`,
	}
	for _, body := range invalid {
		if _, err := decodeSocketEvent([]byte(body)); err == nil {
			t.Fatalf("accepted malformed frame: %s", body)
		}
	}
}

func TestSourceUsesExponentialBackoff(t *testing.T) {
	client, closeClient := testClient(t, func(writer http.ResponseWriter, _ *http.Request) { _, _ = writer.Write([]byte(`{"data":{"id":42}}`)) })
	defer closeClient()
	source := NewSource(client)
	ctx, cancel := context.WithCancel(context.Background())
	waits := make([]time.Duration, 0, 3)
	source.wait = func(_ context.Context, duration time.Duration) error {
		waits = append(waits, duration)
		if len(waits) == 3 {
			cancel()
			return context.Canceled
		}
		return nil
	}
	if err := source.Run(ctx, "access-token", func(Donation) error { return nil }); err != nil {
		t.Fatal(err)
	}
	expected := []time.Duration{5 * time.Second, 10 * time.Second, 20 * time.Second}
	if !reflect.DeepEqual(waits, expected) {
		t.Fatalf("backoff = %v; want %v", waits, expected)
	}
}

func TestSourceUsesExponentialBackoffForInvalidSocketMessages(t *testing.T) {
	client, closeClient := testClient(t, func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = writer.Write([]byte(`{"data":{"id":42,"socket_connection_token":"socket-token"}}`))
	})
	defer closeClient()
	source := NewSource(client)
	source.dial = func(context.Context, string) (Socket, error) {
		socket := &fakeSocket{reads: make(chan []byte, 1)}
		socket.reads <- []byte(`{"result":{}}`)
		return socket, nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	waits := make([]time.Duration, 0, 3)
	source.wait = func(_ context.Context, duration time.Duration) error {
		waits = append(waits, duration)
		if len(waits) == 3 {
			cancel()
			return context.Canceled
		}
		return nil
	}
	if err := source.Run(ctx, "access-token", func(Donation) error { return nil }); err != nil {
		t.Fatal(err)
	}
	expected := []time.Duration{5 * time.Second, 10 * time.Second, 20 * time.Second}
	if !reflect.DeepEqual(waits, expected) {
		t.Fatalf("backoff = %v; want %v", waits, expected)
	}
}

func TestSourceCreatesIndependentSocketsForConcurrentRuns(t *testing.T) {
	client, closeClient := testClient(t, func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = writer.Write([]byte(`{"data":{"id":42,"socket_connection_token":"socket-token"}}`))
	})
	defer closeClient()
	source := NewSource(client)
	dialed := make(chan *fakeSocket, 2)
	source.dial = func(context.Context, string) (Socket, error) {
		socket := &fakeSocket{reads: make(chan []byte)}
		dialed <- socket
		return socket, nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	finished := make(chan error, 2)
	go func() { finished <- source.Run(ctx, "access-token", func(Donation) error { return nil }) }()
	go func() { finished <- source.Run(ctx, "access-token", func(Donation) error { return nil }) }()
	first, second := <-dialed, <-dialed
	if first == second {
		t.Fatal("concurrent streams shared a socket")
	}
	cancel()
	for range 2 {
		if err := <-finished; err != nil {
			t.Fatal(err)
		}
	}
	if first.closed != 1 || second.closed != 1 {
		t.Fatalf("closed sockets = %d, %d", first.closed, second.closed)
	}
}

func TestSourceDoesNotDialWhenAlreadyCancelled(t *testing.T) {
	client, closeClient := testClient(t, func(http.ResponseWriter, *http.Request) { t.Fatal("unexpected profile request") })
	defer closeClient()
	source := NewSource(client)
	source.dial = func(context.Context, string) (Socket, error) {
		t.Fatal("unexpected socket dial")
		return nil, nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := source.Run(ctx, "access-token", func(Donation) error { return nil }); err != nil {
		t.Fatal(err)
	}
}

func TestSourceClassifiesProfileUnauthorizedWithoutDialling(t *testing.T) {
	client, closeClient := testClient(t, func(writer http.ResponseWriter, _ *http.Request) { writer.WriteHeader(http.StatusUnauthorized) })
	defer closeClient()
	source := NewSource(client)
	source.dial = func(context.Context, string) (Socket, error) {
		t.Fatal("unexpected socket dial")
		return nil, nil
	}
	err := source.Run(context.Background(), "access-token", func(Donation) error { return nil })
	var requestError *RequestError
	if !errors.As(err, &requestError) || !requestError.Unauthorized {
		t.Fatalf("error = %v", err)
	}
}

func TestSourceRetriesInvalidProfileAndSocketFailures(t *testing.T) {
	tests := []struct {
		name       string
		profile    string
		dialError  error
		expectDial bool
	}{
		{name: "invalid profile", profile: `{"data":{"id":42}}`},
		{name: "socket failure", profile: `{"data":{"id":42,"socket_connection_token":"socket-token"}}`, dialError: io.EOF, expectDial: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			client, closeClient := testClient(t, func(writer http.ResponseWriter, _ *http.Request) { _, _ = writer.Write([]byte(test.profile)) })
			defer closeClient()
			source := NewSource(client)
			dialled := false
			source.dial = func(context.Context, string) (Socket, error) {
				dialled = true
				return nil, test.dialError
			}
			ctx, cancel := context.WithCancel(context.Background())
			var waited time.Duration
			source.wait = func(_ context.Context, duration time.Duration) error {
				waited = duration
				cancel()
				return context.Canceled
			}
			if err := source.Run(ctx, "access-token", func(Donation) error { return nil }); err != nil {
				t.Fatal(err)
			}
			if dialled != test.expectDial || waited != 5*time.Second {
				t.Fatalf("dialled=%v waited=%v", dialled, waited)
			}
		})
	}
}

func TestSourceReconnectsAfterCleanSocketClose(t *testing.T) {
	client, closeClient := testClient(t, func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = writer.Write([]byte(`{"data":{"id":42,"socket_connection_token":"socket-token"}}`))
	})
	defer closeClient()
	source := NewSource(client)
	socket := &failingSocket{err: io.EOF, closed: make(chan struct{})}
	source.dial = func(context.Context, string) (Socket, error) { return socket, nil }
	ctx, cancel := context.WithCancel(context.Background())
	source.wait = func(_ context.Context, duration time.Duration) error {
		if duration != 5*time.Second {
			t.Fatalf("retry = %v", duration)
		}
		cancel()
		return context.Canceled
	}
	if err := source.Run(ctx, "access-token", func(Donation) error { return nil }); err != nil {
		t.Fatal(err)
	}
	select {
	case <-socket.closed:
	default:
		t.Fatal("socket was not closed")
	}
}

func TestSourceCancelsPendingReconnect(t *testing.T) {
	client, closeClient := testClient(t, func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = writer.Write([]byte(`{"data":{"id":42,"socket_connection_token":"socket-token"}}`))
	})
	defer closeClient()
	source := NewSource(client)
	source.retryStart = time.Hour
	dialled := make(chan struct{})
	source.dial = func(context.Context, string) (Socket, error) {
		close(dialled)
		return nil, io.EOF
	}
	ctx, cancel := context.WithCancel(context.Background())
	finished := make(chan error, 1)
	go func() { finished <- source.Run(ctx, "access-token", func(Donation) error { return nil }) }()
	<-dialled
	cancel()
	select {
	case err := <-finished:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("pending reconnect did not cancel")
	}
}
