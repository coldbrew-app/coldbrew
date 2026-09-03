package chat

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"
)

type oauthTestStore struct {
	attempt         *OauthAttempt
	createdProvider string
	savedConnection SaveConnection
	savedSource     SaveSource
}

func (store *oauthTestStore) CreateOauthAttempt(_ context.Context, _ string, _ int, provider, _, _ string, _ time.Time) error {
	store.createdProvider = provider
	return nil
}
func (store *oauthTestStore) ConsumeOauthAttempt(context.Context, string, string) (*OauthAttempt, error) {
	return store.attempt, nil
}
func (*oauthTestStore) HasSourceCapacity(context.Context, int, string, string) (bool, error) {
	return true, nil
}
func (store *oauthTestStore) SaveProviderAccount(_ context.Context, _ int, connection SaveConnection, source SaveSource) (string, error) {
	store.savedConnection = connection
	store.savedSource = source
	return "connection-id", nil
}

type oauthRoundTripFunc func(*http.Request) (*http.Response, error)

func (function oauthRoundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

func TestOauthUsesPublicChatURLForCallback(t *testing.T) {
	store := &oauthTestStore{}
	oauth := NewOauth(store, "http://localhost:5173/api/chat", OauthConfigs(&[2]string{"client-id", "client-secret"}, nil, nil), http.DefaultClient)
	authorizationURL, err := oauth.Start(context.Background(), 42, "youtube", "http://localhost:5173/chat")
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := url.Parse(authorizationURL)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Query().Get("redirect_uri") != "http://localhost:5173/api/chat/oauth/youtube/callback" || parsed.Query().Get("code_challenge_method") != "S256" || store.createdProvider != "youtube" {
		t.Fatalf("unexpected OAuth start URL: %s", parsed)
	}
}

func TestOauthSubscribesToKickChatWebhook(t *testing.T) {
	store := &oauthTestStore{attempt: &OauthAttempt{UserID: 42, Provider: "kick", Verifier: "verifier", ReturnURL: "http://localhost:5173/chat"}}
	requestNumber := 0
	var subscriptionBody map[string]any
	client := &http.Client{Transport: oauthRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		requestNumber++
		switch requestNumber {
		case 1:
			return oauthResponse(`{"access_token":"token"}`), nil
		case 2:
			return oauthResponse(`{"data":[{"broadcaster_user_id":123,"slug":"streamer"}]}`), nil
		case 3:
			if request.Header.Get("Content-Type") != "application/json" {
				t.Fatalf("unexpected Kick subscription content type: %q", request.Header.Get("Content-Type"))
			}
			body, err := io.ReadAll(request.Body)
			if err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal(body, &subscriptionBody); err != nil {
				t.Fatal(err)
			}
			return oauthResponse(`{"data":[]}`), nil
		default:
			t.Fatalf("unexpected request %d: %s", requestNumber, request.URL)
			return nil, nil
		}
	})}
	oauth := NewOauth(store, "http://localhost:5173/api/chat", OauthConfigs(nil, nil, &[2]string{"client-id", "client-secret"}), client)
	returnURL, err := oauth.Finish(context.Background(), "kick", "http://localhost:5173/api/chat/oauth/kick/callback?state=state&code=code")
	if err != nil {
		t.Fatal(err)
	}
	if returnURL != "http://localhost:5173/chat" || requestNumber != 3 {
		t.Fatalf("returnURL=%q requests=%d", returnURL, requestNumber)
	}
	if subscriptionBody["broadcaster_user_id"] != float64(123) || subscriptionBody["method"] != "webhook" {
		t.Fatalf("unexpected Kick subscription: %#v", subscriptionBody)
	}
	events, ok := subscriptionBody["events"].([]any)
	if !ok || len(events) != 1 || events[0].(map[string]any)["name"] != "chat.message.sent" {
		t.Fatalf("unexpected Kick events: %#v", subscriptionBody["events"])
	}
	if store.savedConnection.ProviderUserID != "123" || store.savedSource.SourceURL != "https://kick.com/streamer" {
		t.Fatalf("unexpected saved account: %#v %#v", store.savedConnection, store.savedSource)
	}
}

func TestOauthRejectsTokenResponsesOutsideOriginalSchema(t *testing.T) {
	responses := []string{
		`{"access_token":"token","refresh_token":""}`,
		`{"access_token":"token","expires_in":0}`,
		`{"access_token":"token","scope":42}`,
		`{"access_token":"token","scope":["chat:read",42]}`,
	}
	for _, body := range responses {
		oauth := NewOauth(&oauthTestStore{}, "https://chat.example/api/chat", nil, &http.Client{Transport: oauthRoundTripFunc(func(*http.Request) (*http.Response, error) {
			return oauthResponse(body), nil
		})})
		_, err := oauth.exchangeToken(context.Background(), ProviderConfig{Provider: "youtube", ClientID: "client", ClientSecret: "secret", TokenURL: "https://oauth.example/token"}, "code", "verifier")
		if err == nil {
			t.Fatalf("accepted invalid token response: %s", body)
		}
	}
}

func oauthResponse(body string) *http.Response {
	return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}
}
