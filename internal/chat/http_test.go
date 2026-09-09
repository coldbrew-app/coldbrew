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
	toggled   *Source
}

func (application *httpTestApplication) Config(context.Context, int) (Config, error) {
	return application.config, application.configErr
}
func (application *httpTestApplication) Stream(context.Context, int) <-chan StreamEvent {
	return application.events
}
func (*httpTestApplication) RefreshSource(context.Context, int, string) error { return nil }
func (application *httpTestApplication) SetSourceEnabled(_ context.Context, _ int, sourceID string, enabled bool) error {
	application.toggled = &Source{SourceID: sourceID, Enabled: enabled}
	return nil
}
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
	started       string
}

func (oauth *httpTestOauth) Available(provider string) bool { return oauth.available[provider] }
func (oauth *httpTestOauth) Start(_ context.Context, _ int, provider, _ string) (string, error) {
	oauth.started = provider
	return "https://oauth.example/authorize", nil
}
func (oauth *httpTestOauth) Finish(_ context.Context, _, callbackURL string) (string, error) {
	oauth.callbackURL = callbackURL
	return oauth.returnURL, oauth.callbackError
}

type httpTestStore struct{}

func (*httpTestStore) Disconnect(context.Context, int, string) error { return nil }

type httpTestDeadLetters struct {
	beforeSequence uint64
	limit          int
	page           DeadLetterPage
}

func (deadLetters *httpTestDeadLetters) List(_ context.Context, limit int, beforeSequence uint64) (DeadLetterPage, error) {
	deadLetters.limit = limit
	deadLetters.beforeSequence = beforeSequence
	return deadLetters.page, nil
}

func newHTTPTestHandler(application *httpTestApplication) (*HTTPHandler, *httpTestOauth) {
	oauth := &httpTestOauth{available: map[string]bool{"youtube": true}, returnURL: "https://web.example/chat"}
	return newHTTPTestHandlerWithDeadLetters(application, oauth, &httpTestDeadLetters{}), oauth
}

func newHTTPTestHandlerWithDeadLetters(application *httpTestApplication, oauth *httpTestOauth, deadLetters DeadLetterReader) *HTTPHandler {
	return NewHTTPHandler(application, oauth, &httpTestStore{}, httpTestSecret, "https://web.example", nil, nil, deadLetters)
}

func TestHTTPHandlerListsDeadLetters(t *testing.T) {
	application := &httpTestApplication{}
	oauth := &httpTestOauth{available: map[string]bool{}}
	deadLetters := &httpTestDeadLetters{page: DeadLetterPage{Items: []DeadLetter{{Sequence: "41", SourceSubject: "chat.user.42", Error: "invalid character", Payload: []byte("not-json")}}, Total: 1}}
	handler := newHTTPTestHandlerWithDeadLetters(application, oauth, deadLetters)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, authorizedRequest(http.MethodGet, "/internal/dead-letters?limit=10&beforeSequence=42", ""))
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"sequence":"41"`) || deadLetters.limit != 10 || deadLetters.beforeSequence != 42 {
		t.Fatalf("status=%d page=%+v body=%s", response.Code, deadLetters, response.Body.String())
	}
}

func TestHTTPHandlerRejectsInvalidDeadLetterCursor(t *testing.T) {
	handler, _ := newHTTPTestHandler(&httpTestApplication{})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, authorizedRequest(http.MethodGet, "/internal/dead-letters?beforeSequence=zero", ""))
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
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

func TestHTTPHandlerSetsSourceEnabled(t *testing.T) {
	application := &httpTestApplication{}
	handler, _ := newHTTPTestHandler(application)
	response := httptest.NewRecorder()
	sourceID := "019c58be-a09e-7000-8000-000000000001"
	handler.ServeHTTP(response, authorizedRequest(http.MethodPost, "/internal/sources/enabled", `{"userId":42,"sourceId":"`+sourceID+`","enabled":false}`))
	if response.Code != http.StatusOK || application.toggled == nil || application.toggled.SourceID != sourceID || application.toggled.Enabled {
		t.Fatalf("status=%d toggled=%+v body=%s", response.Code, application.toggled, response.Body.String())
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

func TestHTTPHandlerExposesConfiguredVKVideoAsReadOnly(t *testing.T) {
	handler, oauth := newHTTPTestHandler(&httpTestApplication{})
	oauth.available["vk_video"] = true
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, authorizedRequest(http.MethodGet, "/internal/provider-availability", ""))
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `{"access":"read_only","provider":"vk_video"}`) {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestHTTPHandlerStartsVKVideoOauth(t *testing.T) {
	handler, oauth := newHTTPTestHandler(&httpTestApplication{})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, authorizedRequest(http.MethodPost, "/internal/oauth/start", `{"userId":42,"provider":"vk_video"}`))
	if response.Code != http.StatusOK || oauth.started != "vk_video" {
		t.Fatalf("status=%d provider=%q body=%s", response.Code, oauth.started, response.Body.String())
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
