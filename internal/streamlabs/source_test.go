package streamlabs

import (
	"context"
	"errors"
	"net/http"
	"net/url"
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

func TestSourceConnectsAnswersHeartbeatAndNotifiesForDonation(t *testing.T) {
	client := testClient(t, func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = writer.Write([]byte(`{"socket_token":"socket-token"}`))
	})
	socket := &fakeSocket{reads: make(chan []byte, 4)}
	socket.reads <- []byte(`0{"sid":"socket-id","pingInterval":10000,"pingTimeout":20000}`)
	socket.reads <- []byte(`40{"sid":"namespace-id"}`)
	socket.reads <- []byte(`2`)
	socket.reads <- []byte(`42["event",{"type":"donation","for":"streamlabs","message":[{"id":1}]}]`)
	source := NewSource(client)
	var dialedURL string
	source.dial = func(_ context.Context, rawURL string) (Socket, error) {
		dialedURL = rawURL
		return socket, nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	notifications := 0
	err := source.Run(ctx, "access-token", func() error {
		notifications++
		if notifications == 2 {
			cancel()
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := url.Parse(dialedURL)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Query().Get("EIO") != "4" || parsed.Query().Get("transport") != "websocket" || parsed.Query().Get("token") != "socket-token" {
		t.Fatalf("socket URL = %s", dialedURL)
	}
	if notifications != 2 || socket.closed != 1 || len(socket.writes) != 2 || string(socket.writes[0]) != "40" || string(socket.writes[1]) != "3" {
		t.Fatalf("notifications=%d closed=%d writes=%q", notifications, socket.closed, socket.writes)
	}
}

func TestDecodeEventPacketAcceptsDocumentedDonationNamespaces(t *testing.T) {
	for _, namespace := range []string{"", `,"for":"streamlabs"`} {
		body := `["event",{"type":"donation","message":[{"id":1}]` + namespace + `}]`
		donation, err := decodeEventPacket(body)
		if err != nil || !donation {
			t.Fatalf("packet %s donation=%v error=%v", body, donation, err)
		}
	}
}

func TestDecodeEventPacketIgnoresOtherEvents(t *testing.T) {
	for _, body := range []string{
		`["other",{}]`,
		`["event",{"type":"follow","for":"twitch_account","message":[{}]}]`,
		`["event",{"type":"donation","for":"twitch_account","message":[{}]}]`,
	} {
		donation, err := decodeEventPacket(body)
		if err != nil || donation {
			t.Fatalf("packet %s donation=%v error=%v", body, donation, err)
		}
	}
}

func TestSourceUsesExponentialBackoff(t *testing.T) {
	client := testClient(t, func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = writer.Write([]byte(`{"socket_token":"socket-token"}`))
	})
	source := NewSource(client)
	source.jitter = func(duration time.Duration) time.Duration { return duration }
	source.dial = func(context.Context, string) (Socket, error) { return nil, errors.New("offline") }
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
	if err := source.Run(ctx, "access-token", func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	expected := []time.Duration{5 * time.Second, 10 * time.Second, 20 * time.Second}
	if !reflect.DeepEqual(waits, expected) {
		t.Fatalf("backoff = %v; want %v", waits, expected)
	}
}

func TestSourceReturnsUnauthorizedWithoutDialling(t *testing.T) {
	client := testClient(t, func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusUnauthorized)
	})
	source := NewSource(client)
	source.dial = func(context.Context, string) (Socket, error) {
		t.Fatal("unexpected socket dial")
		return nil, nil
	}
	err := source.Run(context.Background(), "expired", func() error { return nil })
	var requestError *RequestError
	if !errors.As(err, &requestError) || !requestError.Unauthorized {
		t.Fatalf("error = %v", err)
	}
}
