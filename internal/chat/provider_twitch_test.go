package chat

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func twitchTestSource() ConnectedSource {
	source := connectedSource(twitchSourceID, "twitch", CapabilityRead, CapabilitySendMessage)
	source.Source.ProviderSourceID = "42"
	source.Source.DisplayName = "coldbrew"
	source.Credentials = ProviderCredentials{AccessToken: "access-token", RefreshToken: "refresh-token", Scopes: []string{"user:read:chat", "user:write:chat"}, TokenVersion: 1}
	return source
}

func TestTwitchSendMessageRejectsDropReason(t *testing.T) {
	client := &http.Client{Transport: oauthRoundTripFunc(func(*http.Request) (*http.Response, error) {
		return twitchResponse(`{"data":[{"message_id":"message-1","is_sent":false,"drop_reason":{"code":"automod_held","message":"Message held by AutoMod"}}]}`), nil
	})}
	err := NewTwitchProvider("client", "secret", client).SendMessage(context.Background(), twitchTestSource(), "hello")
	providerError, ok := err.(*ProviderError)
	if !ok || providerError.Type != "provider rejected command" || providerError.Detail != "Message held by AutoMod" {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestTwitchSendMessageAcceptsConfirmedDelivery(t *testing.T) {
	client := &http.Client{Transport: oauthRoundTripFunc(func(*http.Request) (*http.Response, error) {
		return twitchResponse(`{"data":[{"message_id":"message-1","is_sent":true,"drop_reason":null}]}`), nil
	})}
	if err := NewTwitchProvider("client", "secret", client).SendMessage(context.Background(), twitchTestSource(), "hello"); err != nil {
		t.Fatal(err)
	}
}

func TestDecodeTwitchEventIgnoresUnknownType(t *testing.T) {
	event, err := decodeTwitchEvent([]byte(`{"metadata":{"message_type":"unrecognized"}}`))
	if err != nil || event != nil {
		t.Fatalf("event=%#v err=%v", event, err)
	}
}

func TestDecodeTwitchEventRejectsMalformedKnownType(t *testing.T) {
	if _, err := decodeTwitchEvent([]byte(`{"metadata":{"message_type":"notification"}}`)); err == nil {
		t.Fatal("expected malformed notification to be rejected")
	}
	if _, err := decodeTwitchEvent([]byte(`{"metadata":{"message_type":"revocation"},"payload":{"subscription":{"status":"authorization_revoked"}}}`)); err == nil {
		t.Fatal("expected revocation without broadcaster condition to be rejected")
	}
}

func TestDecodeTwitchRevocationIncludesBroadcaster(t *testing.T) {
	event, err := decodeTwitchEvent([]byte(`{"metadata":{"message_type":"revocation"},"payload":{"subscription":{"status":"authorization_revoked","condition":{"broadcaster_user_id":"channel-1"}}}}`))
	if err != nil || event == nil || event.Type != "revocation" || event.BroadcasterID != "channel-1" || event.Reason != "authorization_revoked" {
		t.Fatalf("event=%#v err=%v", event, err)
	}
}

type fakeTwitchSocket struct {
	reads  chan []byte
	closed chan struct{}
	once   sync.Once
}

func (socket *fakeTwitchSocket) Read(ctx context.Context) (websocket.MessageType, []byte, error) {
	select {
	case <-ctx.Done():
		return websocket.MessageText, nil, ctx.Err()
	case body := <-socket.reads:
		return websocket.MessageText, body, nil
	}
}
func (socket *fakeTwitchSocket) Close(websocket.StatusCode, string) error {
	socket.once.Do(func() { close(socket.closed) })
	return nil
}

func TestTwitchStreamUsesReconnectURL(t *testing.T) {
	provider := NewTwitchProvider("client", "secret", http.DefaultClient)
	first := &fakeTwitchSocket{reads: make(chan []byte, 1), closed: make(chan struct{})}
	second := &fakeTwitchSocket{reads: make(chan []byte), closed: make(chan struct{})}
	dialed := make(chan string, 2)
	provider.dial = func(_ context.Context, rawURL string) (twitchSocket, error) {
		dialed <- rawURL
		if rawURL == "wss://eventsub.wss.twitch.tv/ws" {
			return first, nil
		}
		return second, nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	events, providerErrors := provider.Stream(ctx, twitchTestSource())
	if event := <-events; event.State != "connecting" {
		t.Fatalf("initial event = %#v", event)
	}
	first.reads <- []byte(`{"metadata":{"message_type":"session_reconnect"},"payload":{"session":{"reconnect_url":"wss://eventsub.wss.twitch.tv/reconnect"}}}`)
	if actual := <-dialed; actual != "wss://eventsub.wss.twitch.tv/ws" {
		t.Fatalf("first URL = %q", actual)
	}
	select {
	case actual := <-dialed:
		if actual != "wss://eventsub.wss.twitch.tv/reconnect" {
			t.Fatalf("reconnect URL = %q", actual)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for reconnect")
	}
	cancel()
	for range providerErrors {
	}
	select {
	case <-second.closed:
	case <-time.After(time.Second):
		t.Fatal("second socket was not closed")
	}
}

func TestTwitchStreamNormalizesNotification(t *testing.T) {
	client := &http.Client{Transport: oauthRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.URL.Path != "/helix/eventsub/subscriptions" {
			t.Fatalf("unexpected request: %s", request.URL)
		}
		return &http.Response{StatusCode: http.StatusAccepted, Body: io.NopCloser(&emptyReader{}), Header: make(http.Header)}, nil
	})}
	provider := NewTwitchProvider("client", "secret", client)
	socket := &fakeTwitchSocket{reads: make(chan []byte, 2), closed: make(chan struct{})}
	provider.dial = func(context.Context, string) (twitchSocket, error) { return socket, nil }
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	events, providerErrors := provider.Stream(ctx, twitchTestSource())
	socket.reads <- []byte(`{"metadata":{"message_type":"session_welcome"},"payload":{"session":{"id":"session-1"}}}`)
	socket.reads <- []byte(`{"metadata":{"message_type":"notification","message_timestamp":"2026-08-27T12:00:00Z"},"payload":{"event":{"broadcaster_user_login":"coldbrew","chatter_user_id":"viewer-1","chatter_user_name":"Viewer","message_id":"message-1","message":{"text":"Hello"}}}}`)
	connecting := <-events
	state := <-events
	message := <-events
	if connecting.State != "connecting" || state.State != "live" || message.Message == nil || message.Message.ID != "message-1" || message.Message.Author.ID != "viewer-1" {
		t.Fatalf("connecting=%#v state=%#v message=%#v", connecting, state, message)
	}
	cancel()
	for err := range providerErrors {
		if err != nil && !errors.Is(err, context.Canceled) {
			t.Fatalf("unexpected provider error: %v", err)
		}
	}
}

func twitchResponse(body string) *http.Response {
	return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}
}
