package chat

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"
)

type refreshStore struct {
	version *int
	input   refreshStoreInput
}

type refreshStoreInput struct {
	connectionID    string
	expectedVersion int
	accessToken     string
	refreshToken    string
	expiresAt       *time.Time
}

func (store *refreshStore) UpdateConnectionCredentials(_ context.Context, connectionID string, expectedVersion int, accessToken, refreshToken string, expiresAt *time.Time) (*int, error) {
	store.input = refreshStoreInput{connectionID: connectionID, expectedVersion: expectedVersion, accessToken: accessToken, refreshToken: refreshToken, expiresAt: expiresAt}
	return store.version, nil
}

func TestTokenRefresherKeepsFreshCredentials(t *testing.T) {
	now := time.Date(2026, 9, 3, 10, 0, 0, 0, time.UTC)
	expiresAt := now.Add(2 * time.Minute)
	source := youtubeTestSource()
	source.Credentials.ExpiresAt = &expiresAt
	store := &refreshStore{}
	refresher := NewTokenRefresher(store, nil, http.DefaultClient)
	refresher.now = func() time.Time { return now }
	actual, err := refresher.Refresh(context.Background(), source)
	if err != nil || actual.Credentials.AccessToken != "access-token" || store.input.connectionID != "" {
		t.Fatalf("source=%#v store=%#v err=%v", actual, store, err)
	}
}

func TestTokenRefresherRotatesCredentialsWithCompareAndSwap(t *testing.T) {
	now := time.Date(2026, 9, 3, 10, 0, 0, 0, time.UTC)
	nextVersion := 2
	store := &refreshStore{version: &nextVersion}
	client := &http.Client{Transport: oauthRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		body, _ := io.ReadAll(request.Body)
		values, _ := url.ParseQuery(string(body))
		if values.Get("refresh_token") != "refresh-token" || values.Get("client_secret") != "secret" {
			t.Fatalf("form = %s", body)
		}
		return youtubeResponse(http.StatusOK, `{"access_token":"next-access","expires_in":3600}`), nil
	})}
	refresher := NewTokenRefresher(store, []RefreshConfig{{Provider: "youtube", ClientID: "client", ClientSecret: "secret", TokenURL: "https://oauth.example/token"}}, client)
	refresher.now = func() time.Time { return now }
	source := youtubeTestSource()
	expired := now.Add(-time.Second)
	source.Credentials.ExpiresAt = &expired
	actual, err := refresher.Refresh(context.Background(), source)
	if err != nil {
		t.Fatal(err)
	}
	if actual.Credentials.AccessToken != "next-access" || actual.Credentials.RefreshToken != "refresh-token" || actual.Credentials.TokenVersion != 2 {
		t.Fatalf("credentials = %#v", actual.Credentials)
	}
	if store.input.expectedVersion != 1 || store.input.connectionID != source.Source.ConnectionID || store.input.expiresAt == nil || !store.input.expiresAt.Equal(now.Add(time.Hour)) {
		t.Fatalf("store input = %#v", store.input)
	}
}

func TestTokenRefresherRejectsConcurrentRotation(t *testing.T) {
	store := &refreshStore{}
	client := &http.Client{Transport: oauthRoundTripFunc(func(*http.Request) (*http.Response, error) {
		return youtubeResponse(http.StatusOK, `{"access_token":"next-access"}`), nil
	})}
	refresher := NewTokenRefresher(store, []RefreshConfig{{Provider: "youtube", ClientID: "client", ClientSecret: "secret", TokenURL: "https://oauth.example/token"}}, client)
	now := time.Now()
	refresher.now = func() time.Time { return now }
	source := youtubeTestSource()
	source.Credentials.ExpiresAt = &now
	_, err := refresher.Refresh(context.Background(), source)
	providerError, ok := err.(*ProviderError)
	if !ok || providerError.Type != "provider unavailable" {
		t.Fatalf("error = %v", err)
	}
}

func TestTokenRefresherRejectsExplicitInvalidOptionalFields(t *testing.T) {
	responses := []string{
		`{"access_token":"next-access","refresh_token":""}`,
		`{"access_token":"next-access","expires_in":0}`,
		`{"access_token":"next-access","expires_in":-1}`,
	}
	for _, body := range responses {
		nextVersion := 2
		store := &refreshStore{version: &nextVersion}
		client := &http.Client{Transport: oauthRoundTripFunc(func(*http.Request) (*http.Response, error) {
			return youtubeResponse(http.StatusOK, body), nil
		})}
		refresher := NewTokenRefresher(store, []RefreshConfig{{Provider: "youtube", ClientID: "client", ClientSecret: "secret", TokenURL: "https://oauth.example/token"}}, client)
		now := time.Now()
		refresher.now = func() time.Time { return now }
		source := youtubeTestSource()
		source.Credentials.ExpiresAt = &now
		_, err := refresher.Refresh(context.Background(), source)
		providerError, ok := err.(*ProviderError)
		if !ok || providerError.Type != "provider unauthorized" || store.input.connectionID != "" {
			t.Fatalf("body=%s error=%v store=%#v", body, err, store)
		}
	}
}

func TestTokenRefreshConfigs(t *testing.T) {
	credentials := &[2]string{"client", "secret"}
	configs := TokenRefreshConfigs(credentials, credentials, credentials)
	if len(configs) != 3 || !strings.Contains(configs[0].TokenURL, "googleapis") || !strings.Contains(configs[1].TokenURL, "twitch") || !strings.Contains(configs[2].TokenURL, "kick") {
		t.Fatalf("configs = %#v", configs)
	}
}
