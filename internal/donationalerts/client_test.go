package donationalerts

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestAuthorizationURL(t *testing.T) {
	parsed, err := url.Parse(AuthorizationURL("client-id", "https://example.com/callback"))
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Scheme+"://"+parsed.Host+parsed.Path != "https://www.donationalerts.com/oauth/authorize" {
		t.Fatalf("unexpected authorization URL: %s", parsed)
	}
	expected := url.Values{"client_id": {"client-id"}, "redirect_uri": {"https://example.com/callback"}, "response_type": {"code"}, "scope": {"oauth-user-show oauth-donation-subscribe oauth-donation-index"}}
	if !reflect.DeepEqual(parsed.Query(), expected) {
		t.Fatalf("query = %#v; want %#v", parsed.Query(), expected)
	}
}

func TestIssueConnection(t *testing.T) {
	requests := 0
	client, closeServer := testClient(t, func(writer http.ResponseWriter, request *http.Request) {
		requests++
		if requests == 1 {
			if request.URL.Path != "/oauth/token" || request.Method != http.MethodPost {
				t.Fatalf("unexpected token request: %s %s", request.Method, request.URL)
			}
			_, _ = writer.Write([]byte(`{"access_token":"access-token","refresh_token":"refresh-token"}`))
			return
		}
		_, _ = writer.Write([]byte(`{"data":{"id":42}}`))
	})
	defer closeServer()
	connection, err := client.IssueConnection(context.Background(), Config{ClientID: "client-id", ClientSecret: "secret"}, "authorization-code", "https://example.com/callback")
	if err != nil {
		t.Fatal(err)
	}
	expected := Connection{Tokens: Tokens{AccessToken: "access-token", RefreshToken: "refresh-token"}, SourceUserID: "42"}
	if connection != expected || requests != 2 {
		t.Fatalf("IssueConnection() = %#v after %d requests; want %#v", connection, requests, expected)
	}
}

func TestRefreshTokens(t *testing.T) {
	client, closeServer := testClient(t, func(writer http.ResponseWriter, request *http.Request) {
		if err := request.ParseForm(); err != nil {
			t.Fatal(err)
		}
		if request.Form.Get("grant_type") != "refresh_token" || request.Form.Get("refresh_token") != "refresh-token" {
			t.Fatalf("unexpected form: %#v", request.Form)
		}
		_, _ = writer.Write([]byte(`{"access_token":"access-token","refresh_token":"new-refresh-token"}`))
	})
	defer closeServer()
	actual, err := client.RefreshTokens(context.Background(), Config{ClientID: "client-id", ClientSecret: "secret"}, "refresh-token")
	if err != nil {
		t.Fatal(err)
	}
	if actual != (Tokens{AccessToken: "access-token", RefreshToken: "new-refresh-token"}) {
		t.Fatalf("RefreshTokens() = %#v", actual)
	}
}

func TestGetDonations(t *testing.T) {
	client, closeServer := testClient(t, func(writer http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer access-token" {
			t.Fatalf("missing authorization header")
		}
		_, _ = writer.Write([]byte(`{"data":[{"id":1,"username":"Streamer","message":"Thank you","amount":"10.00","currency":"USD","created_at":"2026-08-22 12:00:00"}],"meta":{"last_page":1}}`))
	})
	defer closeServer()
	donations, err := client.GetDonations(context.Background(), "access-token")
	if err != nil {
		t.Fatal(err)
	}
	if len(donations) != 1 || donations[0].SourceDonationID != "1" || donations[0].SourceCreatedAt != "2026-08-22 12:00:00" || !donations[0].OccurredAt.Equal(time.Date(2026, 8, 22, 12, 0, 0, 0, time.UTC)) {
		t.Fatalf("unexpected donations: %#v", donations)
	}
}

func TestGetDonationsAfterFiltersEveryBoundedPageWithoutAssumingOrder(t *testing.T) {
	requests := 0
	client, closeServer := testClient(t, func(writer http.ResponseWriter, request *http.Request) {
		requests++
		switch request.URL.Query().Get("page") {
		case "1":
			_, _ = writer.Write([]byte(`{"data":[{"id":10,"username":null,"message":null,"amount":"1.00","currency":"RUB","created_at":"2026-09-13 11:50:00"},{"id":30,"username":null,"message":null,"amount":"3.00","currency":"RUB","created_at":"2026-09-13 12:00:00"}],"meta":{"last_page":2}}`))
		case "2":
			_, _ = writer.Write([]byte(`{"data":[{"id":20,"username":null,"message":null,"amount":"2.00","currency":"RUB","created_at":"2026-09-13 11:56:00"}],"meta":{"last_page":2}}`))
		default:
			t.Fatalf("unexpected recovery page: %s", request.URL.Query().Get("page"))
		}
	})
	defer closeServer()

	cutoff := time.Date(2026, 9, 13, 11, 50, 0, 0, time.UTC)
	donations, err := client.GetDonationsAfter(context.Background(), "access-token", cutoff)
	if err != nil {
		t.Fatal(err)
	}
	if requests != 2 {
		t.Fatalf("recovery requests = %d, want 2", requests)
	}
	if len(donations) != 2 || donations[0].SourceDonationID != "30" || donations[1].SourceDonationID != "20" {
		t.Fatalf("recovered donations = %#v", donations)
	}
}

func TestGetDonationsAfterHasHardPageBudget(t *testing.T) {
	requests := 0
	client, closeServer := testClient(t, func(writer http.ResponseWriter, _ *http.Request) {
		requests++
		if requests > maximumRecentHistoryPages {
			t.Fatalf("recovery exceeded page budget: %d", requests)
		}
		_, _ = writer.Write([]byte(`{"data":[{"id":1,"username":null,"message":null,"amount":"1.00","currency":"RUB","created_at":"2026-09-13 12:00:00"}],"meta":{"last_page":99}}`))
	})
	defer closeServer()

	cutoff := time.Date(2026, 9, 13, 11, 50, 0, 0, time.UTC)
	if _, err := client.GetDonationsAfter(context.Background(), "access-token", cutoff); err != nil {
		t.Fatal(err)
	}
	if requests != maximumRecentHistoryPages {
		t.Fatalf("recovery requests = %d, want %d", requests, maximumRecentHistoryPages)
	}
}

func TestGetDonationsAcceptsNumericAmount(t *testing.T) {
	client, closeServer := testClient(t, func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = writer.Write([]byte(`{"data":[{"id":1,"username":null,"message":null,"amount":10,"currency":"USD","created_at":"2026-08-22 12:00:00"}],"meta":{"last_page":1}}`))
	})
	defer closeServer()
	donations, err := client.GetDonations(context.Background(), "access-token")
	if err != nil {
		t.Fatal(err)
	}
	if len(donations) != 1 || donations[0].Amount != "10.00" {
		t.Fatalf("unexpected numeric amount: %#v", donations)
	}
}

func TestGetDonationsRejectsStringDonationID(t *testing.T) {
	client, closeServer := testClient(t, func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = writer.Write([]byte(`{"data":[{"id":"1","username":null,"message":null,"amount":"10.00","currency":"USD","created_at":"2026-08-22 12:00:00"}],"meta":{"last_page":1}}`))
	})
	defer closeServer()
	if _, err := client.GetDonations(context.Background(), "access-token"); err == nil {
		t.Fatal("expected a string donation id to be rejected")
	}
}

func TestGetDonationsRejectsInvalidDate(t *testing.T) {
	client, closeServer := testClient(t, func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = writer.Write([]byte(`{"data":[{"id":1,"username":null,"message":null,"amount":"10.00","currency":"USD","created_at":"not-a-date"}],"meta":{"last_page":1}}`))
	})
	defer closeServer()
	_, err := client.GetDonations(context.Background(), "access-token")
	var requestError *RequestError
	if !errors.As(err, &requestError) || requestError.Unauthorized || !strings.Contains(err.Error(), "invalid donation date") {
		t.Fatalf("expected request validation error, got %v", err)
	}
}

func TestGetDonationsClassifiesUnauthorized(t *testing.T) {
	client, closeServer := testClient(t, func(writer http.ResponseWriter, _ *http.Request) { writer.WriteHeader(http.StatusUnauthorized) })
	defer closeServer()
	_, err := client.GetDonations(context.Background(), "access-token")
	var requestError *RequestError
	if !errors.As(err, &requestError) || !requestError.Unauthorized {
		t.Fatalf("expected unauthorized request error, got %v", err)
	}
}

func TestClientSpacesAllProviderRESTRequests(t *testing.T) {
	requestTimes := make(chan time.Time, 2)
	client, closeServer := testClient(t, func(writer http.ResponseWriter, request *http.Request) {
		requestTimes <- time.Now()
		if request.URL.Path == "/api/v1/user/oauth" {
			_, _ = writer.Write([]byte(`{"data":{"id":1,"socket_connection_token":"socket-token"}}`))
			return
		}
		_, _ = writer.Write([]byte(`{"data":[],"meta":{"last_page":1}}`))
	})
	defer closeServer()
	client.limiter = newRequestLimiter(25 * time.Millisecond)
	if _, err := client.GetDonations(context.Background(), "access-token"); err != nil {
		t.Fatal(err)
	}
	if _, err := client.SocketProfile(context.Background(), "access-token"); err != nil {
		t.Fatal(err)
	}
	first := <-requestTimes
	second := <-requestTimes
	if spacing := second.Sub(first); spacing < 20*time.Millisecond {
		t.Fatalf("provider request spacing = %s", spacing)
	}
}

func testClient(t *testing.T, handler http.HandlerFunc) (*Client, func()) {
	t.Helper()
	httpClient := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)
		return recorder.Result(), nil
	})}
	client := newUnthrottledClient(httpClient)
	client.BaseURL = "https://donationalerts.test"
	client.PageDelay = 0
	return client, func() {}
}

func newUnthrottledClient(httpClient *http.Client) *Client {
	client := NewClient(httpClient)
	client.limiter = newRequestLimiter(0)
	return client
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (function roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}
