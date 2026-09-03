package chat

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

const httpTestSecret = "12345678901234567890123456789012"

type httpTestApplication struct {
	config    Config
	configErr error
	events    <-chan StreamEvent
}

func (application *httpTestApplication) Config(context.Context, int) (Config, error) {
	return application.config, application.configErr
}
func (application *httpTestApplication) Stream(context.Context, int) <-chan StreamEvent {
	return application.events
}
func (*httpTestApplication) RefreshSource(context.Context, int, string) error { return nil }
func (*httpTestApplication) Broadcast(_ context.Context, _ int, text string) (BroadcastResult, error) {
	return BroadcastResult{Results: []CommandResult{{SourceID: "019c58be-a09e-7000-8000-000000000001", Status: "succeeded", Detail: text}}}, nil
}
func (*httpTestApplication) Moderate(context.Context, int, ModerationCommand) (CommandResult, error) {
	return CommandResult{SourceID: "019c58be-a09e-7000-8000-000000000001", Status: "succeeded"}, nil
}

type httpTestOauth struct {
	available     map[string]bool
	callbackURL   string
	callbackError error
	returnURL     string
}

func (oauth *httpTestOauth) Available(provider string) bool { return oauth.available[provider] }
func (*httpTestOauth) Start(context.Context, int, string, string) (string, error) {
	return "https://oauth.example/authorize", nil
}
func (oauth *httpTestOauth) Finish(_ context.Context, _, callbackURL string) (string, error) {
	oauth.callbackURL = callbackURL
	return oauth.returnURL, oauth.callbackError
}

type httpTestStore struct{}

func (*httpTestStore) Disconnect(context.Context, int, string) error { return nil }

func newHTTPTestHandler(application *httpTestApplication) (*HTTPHandler, *httpTestOauth) {
	oauth := &httpTestOauth{available: map[string]bool{"youtube": true}, returnURL: "https://web.example/chat"}
	return NewHTTPHandler(application, oauth, &httpTestStore{}, httpTestSecret, "https://web.example", nil), oauth
}

func authorizedRequest(method, target, body string) *http.Request {
	request := httptest.NewRequest(method, target, strings.NewReader(body))
	request.Header.Set("Authorization", "Bearer "+httpTestSecret)
	return request
}

func TestHTTPHandlerRequiresServiceAuthentication(t *testing.T) {
	handler, _ := newHTTPTestHandler(&httpTestApplication{})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/internal/config", strings.NewReader(`{"userId":42}`)))
	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), `"error":"unauthorized"`) {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestHTTPHandlerServesValidatedInternalConfig(t *testing.T) {
	connectedAt := time.Date(2026, 9, 3, 9, 0, 0, 0, time.UTC)
	application := &httpTestApplication{config: Config{Connections: []Connection{{ConnectionID: "019c58be-a09e-7000-8000-000000000001", Provider: "youtube", ProviderUserID: "channel-1", DisplayName: "Channel", Status: "connected", Capabilities: []Capability{CapabilityRead}, ConnectedAt: connectedAt}}, Sources: []Source{}, HasOverlayToken: false}}
	handler, _ := newHTTPTestHandler(application)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, authorizedRequest(http.MethodPost, "/internal/config", `{"userId":42}`))
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"connectedAt":"2026-09-03T09:00:00Z"`) {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestHTTPHandlerRejectsUnknownInputFields(t *testing.T) {
	handler, _ := newHTTPTestHandler(&httpTestApplication{})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, authorizedRequest(http.MethodPost, "/internal/config", `{"userId":42,"scope":"editor"}`))
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestHTTPHandlerDecodesInternalMutation(t *testing.T) {
	handler, _ := newHTTPTestHandler(&httpTestApplication{})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, authorizedRequest(http.MethodPost, "/internal/broadcast", `{"userId":42,"text":"hello"}`))
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"detail":"hello"`) {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestHTTPHandlerDoesNotExposeInternalErrors(t *testing.T) {
	handler, _ := newHTTPTestHandler(&httpTestApplication{configErr: context.DeadlineExceeded})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, authorizedRequest(http.MethodPost, "/internal/config", `{"userId":42}`))
	if response.Code != http.StatusInternalServerError || strings.Contains(response.Body.String(), "deadline") {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestHTTPHandlerStreamsNDJSON(t *testing.T) {
	events := make(chan StreamEvent, 1)
	events <- StreamEvent{Type: "message", Message: &Message{ID: "message-1", SourceID: "019c58be-a09e-7000-8000-000000000001", ConnectionID: "019c58be-a09e-7000-8000-000000000002", Provider: "youtube", Author: Author{ID: "author-1", DisplayName: "Viewer"}, Text: "hello", OccurredAt: time.Date(2026, 9, 3, 9, 0, 0, 0, time.UTC)}}
	close(events)
	handler, _ := newHTTPTestHandler(&httpTestApplication{events: events})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, authorizedRequest(http.MethodGet, "/internal/stream?userId=42", ""))
	if response.Header().Get("Content-Type") != "application/x-ndjson" || !strings.Contains(response.Body.String(), `"occurredAt":"2026-09-03T09:00:00Z"`) {
		t.Fatalf("headers=%v body=%s", response.Header(), response.Body.String())
	}
}

func TestHTTPHandlerOauthCallbackUsesForwardedPublicURL(t *testing.T) {
	handler, oauth := newHTTPTestHandler(&httpTestApplication{})
	request := authorizedRequest(http.MethodGet, "/oauth/youtube/callback?state=state&code=code", "")
	request.Header.Set("X-Forwarded-Host", "coldbrew.example")
	request.Header.Set("X-Forwarded-Prefix", "/api/chat")
	request.Header.Set("X-Forwarded-Proto", "https")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusFound || oauth.callbackURL != "https://coldbrew.example/api/chat/oauth/youtube/callback?state=state&code=code" {
		t.Fatalf("status=%d callback=%s", response.Code, oauth.callbackURL)
	}
}

func TestHTTPHandlerOauthCallbackReportsSafeErrorType(t *testing.T) {
	handler, oauth := newHTTPTestHandler(&httpTestApplication{})
	oauth.callbackError = &OauthError{Type: "oauth token exchange failed", Detail: "provider response contained a secret", ReturnURL: "https://web.example/chat"}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, authorizedRequest(http.MethodGet, "/oauth/youtube/callback?state=state&code=code", ""))
	location, err := url.Parse(response.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusFound || location.Query().Get("chat_oauth") != "error" || location.Query().Get("chat_oauth_error") != "oauth token exchange failed" || strings.Contains(location.String(), "secret") {
		t.Fatalf("status=%d location=%s", response.Code, location)
	}
}

func TestHTTPHandlerNoLongerExposesTRPC(t *testing.T) {
	handler, _ := newHTTPTestHandler(&httpTestApplication{})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, authorizedRequest(http.MethodGet, "/trpc/config", ""))
	if response.Code != http.StatusNotFound {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}
