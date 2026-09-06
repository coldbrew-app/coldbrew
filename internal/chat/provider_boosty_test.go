package chat

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"
)

type boostyTestStore struct {
	capacity   bool
	connection SaveConnection
	source     SaveSource
	userID     int
	saves      int
}

func (s *boostyTestStore) HasSourceCapacity(_ context.Context, userID int, provider, blog string) (bool, error) {
	return s.capacity, nil
}
func (s *boostyTestStore) SaveProviderAccount(_ context.Context, userID int, c SaveConnection, source SaveSource) (string, error) {
	s.connection = c
	s.source = source
	s.userID = userID
	s.saves++
	return "connection", nil
}

func TestBoostyConnectOwnedAccount(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer session-token" {
			t.Errorf("token header: %q", r.Header.Get("Authorization"))
		}
		switch r.URL.Path {
		case "/v1/user/current":
			_, _ = w.Write([]byte(`{"id":42,"name":"Streamer","blogUrl":"My.Blog"}`))
		case "/v1/blog/my.blog":
			_, _ = w.Write([]byte(`{"owner":{"id":42}}`))
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	provider := NewBoostyProvider(server.Client())
	provider.apiURL = server.URL
	store := &boostyTestStore{capacity: true}
	if err := NewBoostyConnector(provider, store).Connect(context.Background(), 7, BoostyCredentials{AccessToken: " session-token ", RefreshToken: " refresh-token ", DeviceID: " device-1 "}); err != nil {
		t.Fatal(err)
	}
	if store.userID != 7 || store.source.ProviderSourceID != "my.blog" || store.connection.ProviderUserID != "42" || store.connection.AccessToken != "session-token" || store.saves != 1 || store.connection.RefreshToken != "refresh-token" || store.connection.OAuthDeviceID != "device-1" {
		t.Fatalf("unexpected saved account: %+v", store)
	}
}

func TestBoostyRejectsInvalidConnections(t *testing.T) {
	for _, test := range []struct {
		name     string
		identity string
		owner    string
		status   int
		capacity bool
		token    string
	}{
		{"unauthorized", `{}`, `{}`, 401, true, "token"},
		{"foreign blog", `{"id":42,"name":"A","blogUrl":"blog"}`, `{"owner":{"id":43}}`, 200, true, "token"},
		{"no blog", `{"id":42,"name":"A"}`, `{}`, 200, true, "token"},
		{"unsafe blog", `{"id":42,"name":"A","blogUrl":"../user"}`, `{}`, 200, true, "token"},
		{"capacity", `{"id":42,"name":"A","blogUrl":"blog"}`, `{"owner":{"id":42}}`, 200, false, "token"},
		{"header injection", `{}`, `{}`, 200, true, "token\r\nfoo"},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(test.status)
				if r.URL.Path == "/v1/user/current" {
					_, _ = w.Write([]byte(test.identity))
				} else {
					_, _ = w.Write([]byte(test.owner))
				}
			}))
			defer server.Close()
			p := NewBoostyProvider(server.Client())
			p.apiURL = server.URL
			store := &boostyTestStore{capacity: test.capacity}
			if err := NewBoostyConnector(p, store).Connect(context.Background(), 1, BoostyCredentials{AccessToken: test.token}); err == nil {
				t.Fatal("expected rejection")
			}
			if store.saves != 0 {
				t.Fatal("saved rejected credentials")
			}
		})
	}
}

func TestBoostyStreamSkipsHistoryAndCatchesUpInOrder(t *testing.T) {
	polls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/blog/blog/video_stream" {
			_, _ = w.Write([]byte(`{"isOnline":true,"hasAccess":true}`))
			return
		}
		page := `{"data":[{"id":"old"}],"extra":{"isLast":true}}`
		if r.URL.Query().Get("offset") == "older" {
			page = `{"data":[{"id":"old"}],"extra":{"isLast":true}}`
		} else {
			polls++
			if polls > 1 {
				page = `{"data":[{"id":"new2","author":{"id":2,"name":"B"},"createdAt":1788652802,"data":[{"type":"text","content":"[\"Hello\",\"unstyled\",[]]"}]},{"id":"new1","author":{"id":1,"name":"A"},"createdAt":1788652801,"data":[{"type":"text","content":"First"}]}],"extra":{"offset":"older","isLast":false}}`
			}
		}
		_, _ = w.Write([]byte(page))
	}))
	defer server.Close()
	p := NewBoostyProvider(server.Client())
	p.apiURL = server.URL
	waits := 0
	p.wait = func(context.Context, time.Duration) bool { waits++; return waits < 3 }
	source := ConnectedSource{Source: Source{SourceID: "source", ConnectionID: "connection", Provider: "boosty", ProviderSourceID: "blog"}, Credentials: ProviderCredentials{AccessToken: "token"}}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	events, failures := p.Stream(ctx, source)
	var messages []Message
	for events != nil || failures != nil {
		select {
		case e, ok := <-events:
			if !ok {
				events = nil
			} else if e.Message != nil {
				messages = append(messages, *e.Message)
			}
		case err, ok := <-failures:
			if !ok {
				failures = nil
			} else {
				t.Fatal(err)
			}
		case <-ctx.Done():
			t.Fatal("collector did not stop")
		}
	}
	if len(messages) != 2 || messages[0].ID != "new1" || messages[1].ID != "new2" || messages[1].Text != "Hello" || messages[1].SourceID != "source" {
		t.Fatalf("messages: %+v", messages)
	}
}

func TestBoostyStreamUnauthorizedWaitsForReconnect(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(401) }))
	defer server.Close()
	p := NewBoostyProvider(server.Client())
	p.apiURL = server.URL
	ctx, cancel := context.WithCancel(context.Background())
	events, failures := p.Stream(ctx, ConnectedSource{Source: Source{ProviderSourceID: "blog"}, Credentials: ProviderCredentials{AccessToken: "token"}})
	<-events
	if err := <-failures; providerErrorType(err) != "provider unauthorized" {
		t.Fatalf("error: %v", err)
	}
	cancel()
	select {
	case _, ok := <-events:
		if ok {
			t.Fatal("unexpected event")
		}
	case <-time.After(time.Second):
		t.Fatal("did not cancel")
	}
}

func TestBoostyMessagesIgnoreSystemAndUnsupportedContent(t *testing.T) {
	var raw boostyMessage
	if err := json.Unmarshal([]byte(`{"id":"1","author":{"id":1,"name":"A"},"createdAt":1788652800,"data":[{"type":"text","content":"Hello"},{"type":"image","content":"private-image-url"},{"type":"text","modificator":"BLOCK_END"},{"type":"link","content":"https://example.com"}]}`), &raw); err != nil {
		t.Fatal(err)
	}
	m, ok := raw.normalize(Source{})
	if !ok || m.Text != "Hello\nhttps://example.com" {
		t.Fatalf("message: %+v", m)
	}
	raw.IsSystemMessage = true
	if _, ok := raw.normalize(Source{}); ok {
		t.Fatal("system message emitted")
	}
	if !reflect.DeepEqual(CapabilitiesFor("boosty", nil), []Capability{CapabilityRead}) {
		t.Fatal("Boosty must be read-only")
	}
}

func TestBoostyStreamReportsProtocolErrorsAndRetries(t *testing.T) {
	for _, payload := range []string{`not json`, `{"extra":{"isLast":true}}`, `{"data":[],"extra":null}`} {
		t.Run(payload, func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if calls == 1 {
					w.WriteHeader(http.StatusTooManyRequests)
					return
				}
				if r.URL.Path == "/v1/blog/blog/video_stream" {
					_, _ = w.Write([]byte(`{"isOnline":true,"hasAccess":true}`))
					return
				}
				_, _ = w.Write([]byte(payload))
			}))
			defer server.Close()
			p := NewBoostyProvider(server.Client())
			p.apiURL = server.URL
			waits := 0
			p.wait = func(context.Context, time.Duration) bool { waits++; return waits < 2 }
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			events, failures := p.Stream(ctx, ConnectedSource{Source: Source{ProviderSourceID: "blog"}, Credentials: ProviderCredentials{AccessToken: "token"}})
			errorsSeen := 0
			for events != nil || failures != nil {
				select {
				case _, ok := <-events:
					if !ok {
						events = nil
					}
				case err, ok := <-failures:
					if !ok {
						failures = nil
					} else {
						errorsSeen++
						if errorsSeen == 1 && providerErrorType(err) != "provider rate limited" {
							t.Fatal(err)
						}
					}
				case <-ctx.Done():
					t.Fatal("collector did not stop")
				}
			}
			if errorsSeen != 2 || waits != 2 {
				t.Fatalf("errors %d, waits %d", errorsSeen, waits)
			}
		})
	}
}
