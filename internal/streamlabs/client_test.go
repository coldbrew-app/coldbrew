package streamlabs

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"testing"
	"time"
)

func TestAuthorizationURL(t *testing.T) {
	parsed, err := url.Parse(AuthorizationURL("client-id", "https://coldbrew.test/callback", "oauth-state"))
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Scheme+"://"+parsed.Host+parsed.Path != "https://streamlabs.com/api/v2.0/authorize" {
		t.Fatalf("unexpected authorization URL: %s", parsed)
	}
	expected := url.Values{
		"client_id":     {"client-id"},
		"redirect_uri":  {"https://coldbrew.test/callback"},
		"response_type": {"code"},
		"scope":         {"donations.read socket.token"},
		"state":         {"oauth-state"},
	}
	if !reflect.DeepEqual(parsed.Query(), expected) {
		t.Fatalf("query = %#v; want %#v", parsed.Query(), expected)
	}
}

func TestIssueConnectionUsesJSONAndReadsStreamlabsIdentity(t *testing.T) {
	requests := 0
	client := testClient(t, func(writer http.ResponseWriter, request *http.Request) {
		requests++
		if requests == 1 {
			if request.URL.Path != "/token" || request.Method != http.MethodPost || request.Header.Get("Content-Type") != "application/json" {
				t.Fatalf("unexpected token request: %s %s headers=%v", request.Method, request.URL, request.Header)
			}
			var body map[string]string
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if body["code"] != "authorization-code" || body["redirect_uri"] != "https://coldbrew.test/callback" {
				t.Fatalf("token body = %#v", body)
			}
			_, _ = writer.Write([]byte(`{"access_token":"access-token","refresh_token":"refresh-token"}`))
			return
		}
		if request.URL.Path != "/user" || request.Header.Get("Authorization") != "Bearer access-token" {
			t.Fatalf("unexpected profile request: %s headers=%v", request.URL, request.Header)
		}
		_, _ = writer.Write([]byte(`{"streamlabs":{"id":42,"display_name":"Streamer"}}`))
	})

	connection, err := client.IssueConnection(context.Background(), Config{ClientID: "client-id", ClientSecret: "secret"}, "authorization-code", "https://coldbrew.test/callback")
	if err != nil {
		t.Fatal(err)
	}
	expected := Connection{Tokens: Tokens{AccessToken: "access-token", RefreshToken: "refresh-token"}, SourceUserID: "42"}
	if connection != expected || requests != 2 {
		t.Fatalf("IssueConnection() = %#v after %d requests; want %#v", connection, requests, expected)
	}
}

func TestRefreshTokensUsesConfiguredRedirectURI(t *testing.T) {
	client := testClient(t, func(writer http.ResponseWriter, request *http.Request) {
		var body map[string]string
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body["grant_type"] != "refresh_token" || body["refresh_token"] != "old-refresh" || body["redirect_uri"] != "https://coldbrew.test/callback" {
			t.Fatalf("refresh body = %#v", body)
		}
		_, _ = writer.Write([]byte(`{"access_token":"new-access","refresh_token":"new-refresh"}`))
	})
	tokens, err := client.RefreshTokens(context.Background(), Config{ClientID: "client-id", ClientSecret: "secret", RedirectURI: "https://coldbrew.test/callback"}, "old-refresh")
	if err != nil {
		t.Fatal(err)
	}
	if tokens != (Tokens{AccessToken: "new-access", RefreshToken: "new-refresh"}) {
		t.Fatalf("tokens = %#v", tokens)
	}
}

func TestGetDonationsWalksHistoryWithoutCurrencyConversion(t *testing.T) {
	requests := 0
	client := testClient(t, func(writer http.ResponseWriter, request *http.Request) {
		requests++
		if request.Header.Get("Authorization") != "Bearer access-token" || request.URL.Query().Has("currency") || request.URL.Query().Has("verified") {
			t.Fatalf("unexpected request: %s headers=%v", request.URL, request.Header)
		}
		if requests == 1 {
			if request.URL.Query().Get("limit") != "100" || request.URL.Query().Has("before") {
				t.Fatalf("first page query = %v", request.URL.Query())
			}
			_, _ = writer.Write([]byte(`{"data":[{"donation_id":"20","created_at":"1438576556","currency":"USD","amount":"50","name":"Thomas","message":"nice!"},{"donation_id":"10","created_at":"1438576521","currency":"EUR","amount":"15.5","name":null,"message":null}]}`))
			return
		}
		if request.URL.Query().Get("before") != "10" {
			t.Fatalf("second page query = %v", request.URL.Query())
		}
		_, _ = writer.Write([]byte(`{"data":[]}`))
	})
	client.PageDelay = 0

	history, err := client.GetDonations(context.Background(), "access-token", nil)
	if err != nil {
		t.Fatal(err)
	}
	if requests != 2 || len(history.Donations) != 2 || history.Checkpoint == nil || *history.Checkpoint != "20" {
		t.Fatalf("history = %#v after %d requests", history, requests)
	}
	first := history.Donations[0]
	if first.SourceDonationID != "20" || first.Amount != "50.00" || first.SourceCreatedAt != "1438576556" || !first.OccurredAt.Equal(time.Unix(1438576556, 0).UTC()) {
		t.Fatalf("first donation = %#v", first)
	}
}

func TestGetDonationsStopsAtCheckpoint(t *testing.T) {
	checkpoint := "10"
	client := testClient(t, func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = writer.Write([]byte(`{"data":[{"donation_id":"20","created_at":"1438576556","currency":"USD","amount":"2","name":"New","message":null},{"donation_id":"10","created_at":"1438576521","currency":"USD","amount":"1","name":"Old","message":null}]}`))
	})
	client.PageDelay = 0
	history, err := client.GetDonations(context.Background(), "access-token", &checkpoint)
	if err != nil {
		t.Fatal(err)
	}
	if len(history.Donations) != 1 || history.Donations[0].SourceDonationID != "20" || history.Checkpoint == nil || *history.Checkpoint != "20" {
		t.Fatalf("history = %#v", history)
	}
}

func TestGetDonationsRejectsInvalidSourceValues(t *testing.T) {
	client := testClient(t, func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = writer.Write([]byte(`{"data":[{"donation_id":"20","created_at":"not-a-time","currency":"usd","amount":"2","name":"New","message":null}]}`))
	})
	client.PageDelay = 0
	_, err := client.GetDonations(context.Background(), "access-token", nil)
	var requestError *RequestError
	if !errors.As(err, &requestError) || requestError.Unauthorized {
		t.Fatalf("expected validation request error, got %v", err)
	}
}

func TestSocketTokenClassifiesUnauthorized(t *testing.T) {
	client := testClient(t, func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusUnauthorized)
	})
	_, err := client.SocketToken(context.Background(), "expired")
	var requestError *RequestError
	if !errors.As(err, &requestError) || !requestError.Unauthorized {
		t.Fatalf("expected unauthorized request error, got %v", err)
	}
}

func testClient(t *testing.T, handler http.HandlerFunc) *Client {
	t.Helper()
	httpClient := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)
		return recorder.Result(), nil
	})}
	client := NewClient(httpClient)
	client.BaseURL = "https://streamlabs.test"
	return client
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (function roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}
