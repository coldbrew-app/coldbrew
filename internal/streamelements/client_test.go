package streamelements

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"testing"
	"time"
)

const testChannelID = "5ad23c8f0a4d8c4bb77f1a2b"

func TestAuthorizationURL(t *testing.T) {
	parsed, err := url.Parse(AuthorizationURL("client-id", "https://streambrew.test/callback", "oauth-state"))
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Scheme+"://"+parsed.Host+parsed.Path != "https://api.streamelements.com/oauth2/authorize" {
		t.Fatalf("unexpected authorization URL: %s", parsed)
	}
	want := url.Values{
		"client_id":     {"client-id"},
		"redirect_uri":  {"https://streambrew.test/callback"},
		"response_type": {"code"},
		"scope":         {"channel:read tips:read"},
		"state":         {"oauth-state"},
	}
	if !reflect.DeepEqual(parsed.Query(), want) {
		t.Fatalf("query = %#v; want %#v", parsed.Query(), want)
	}
}

func TestIssueConnectionExchangesFormAndReadsChannelProfile(t *testing.T) {
	requests := 0
	client := testClient(t, func(writer http.ResponseWriter, request *http.Request) {
		requests++
		switch requests {
		case 1:
			if request.Method != http.MethodPost || request.URL.Path != "/oauth2/token" {
				t.Fatalf("token request = %s %s", request.Method, request.URL)
			}
			if request.Header.Get("Content-Type") != "application/x-www-form-urlencoded" {
				t.Fatalf("content type = %q", request.Header.Get("Content-Type"))
			}
			if request.Header.Get("Authorization") != "" {
				t.Fatalf("unexpected token authorization header: %q", request.Header.Get("Authorization"))
			}
			if err := request.ParseForm(); err != nil {
				t.Fatal(err)
			}
			want := url.Values{
				"grant_type":    {"authorization_code"},
				"client_id":     {"client-id"},
				"client_secret": {"client-secret"},
				"code":          {"authorization-code"},
				"redirect_uri":  {"https://streambrew.test/callback"},
			}
			if !reflect.DeepEqual(request.PostForm, want) {
				t.Fatalf("token form = %#v; want %#v", request.PostForm, want)
			}
			_, _ = writer.Write([]byte(`{"access_token":"access-token","refresh_token":"refresh-token","token_type":"Bearer","expires_in":3600,"scope":"channel:read tips:read"}`))
		case 2:
			if request.Method != http.MethodGet || request.URL.Path != "/kappa/v2/channels/me" {
				t.Fatalf("profile request = %s %s", request.Method, request.URL)
			}
			if request.Header.Get("Authorization") != "OAuth access-token" {
				t.Fatalf("profile authorization = %q", request.Header.Get("Authorization"))
			}
			_, _ = writer.Write([]byte(`{"_id":"  ` + testChannelID + `  ","username":"streamer"}`))
		default:
			t.Fatalf("unexpected request %d", requests)
		}
	})

	connection, err := client.IssueConnection(
		context.Background(),
		Config{ClientID: "client-id", ClientSecret: "client-secret"},
		"authorization-code",
		"https://streambrew.test/callback",
	)
	if err != nil {
		t.Fatal(err)
	}
	want := Connection{
		Tokens:       Tokens{AccessToken: "access-token", RefreshToken: "refresh-token"},
		SourceUserID: testChannelID,
	}
	if connection != want || requests != 2 {
		t.Fatalf("connection = %#v after %d requests; want %#v", connection, requests, want)
	}
}

func TestRefreshTokensUsesDocumentedFormWithoutRedirectURI(t *testing.T) {
	client := testClient(t, func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/oauth2/token" || request.Method != http.MethodPost {
			t.Fatalf("refresh request = %s %s", request.Method, request.URL)
		}
		if err := request.ParseForm(); err != nil {
			t.Fatal(err)
		}
		want := url.Values{
			"grant_type":    {"refresh_token"},
			"client_id":     {"client-id"},
			"client_secret": {"client-secret"},
			"refresh_token": {"old-refresh-token"},
		}
		if !reflect.DeepEqual(request.PostForm, want) {
			t.Fatalf("refresh form = %#v; want %#v", request.PostForm, want)
		}
		if request.PostForm.Has("redirect_uri") {
			t.Fatalf("refresh form unexpectedly contains redirect_uri: %#v", request.PostForm)
		}
		_, _ = writer.Write([]byte(`{"access_token":"new-access-token","refresh_token":"rotated-refresh-token"}`))
	})

	tokens, err := client.RefreshTokens(context.Background(), Config{
		ClientID:     "client-id",
		ClientSecret: "client-secret",
	}, "old-refresh-token")
	if err != nil {
		t.Fatal(err)
	}
	if tokens != (Tokens{AccessToken: "new-access-token", RefreshToken: "rotated-refresh-token"}) {
		t.Fatalf("tokens = %#v", tokens)
	}
}

func TestIssueConnectionRejectsIncompleteResponses(t *testing.T) {
	tests := []struct {
		name      string
		tokenBody string
		profile   string
	}{
		{name: "access token", tokenBody: `{"refresh_token":"refresh"}`},
		{name: "refresh token", tokenBody: `{"access_token":"access"}`},
		{name: "channel id", tokenBody: `{"access_token":"access","refresh_token":"refresh"}`, profile: `{}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			requests := 0
			client := testClient(t, func(writer http.ResponseWriter, _ *http.Request) {
				requests++
				if requests == 1 {
					_, _ = writer.Write([]byte(test.tokenBody))
					return
				}
				_, _ = writer.Write([]byte(test.profile))
			})
			_, err := client.IssueConnection(context.Background(), Config{}, "code", "callback")
			var requestError *RequestError
			if !errors.As(err, &requestError) || requestError.Unauthorized {
				t.Fatalf("error = %v; want non-authorization RequestError", err)
			}
		})
	}
}

func TestGetDonationsPaginatesLegacyHistoryAndPreservesOriginalMoney(t *testing.T) {
	requests := 0
	client := testClient(t, func(writer http.ResponseWriter, request *http.Request) {
		requests++
		if request.Method != http.MethodGet || request.URL.Path != "/kappa/v2/tips/"+testChannelID {
			t.Fatalf("history request = %s %s", request.Method, request.URL)
		}
		if request.Header.Get("Authorization") != "OAuth access-token" {
			t.Fatalf("authorization = %q", request.Header.Get("Authorization"))
		}
		query := request.URL.Query()
		if query.Get("limit") != "100" || query.Get("sort") != "-createdAt" || query.Get("tz") != "0" ||
			query.Get("before") != "2025-02-20T10:30:00.123Z" {
			t.Fatalf("query = %v", query)
		}
		if query.Has("after") {
			t.Fatalf("ordinary checkpoint traversal unexpectedly has after: %v", query)
		}
		switch requests {
		case 1:
			if query.Get("offset") != "0" {
				t.Fatalf("first offset = %q", query.Get("offset"))
			}
			_, _ = writer.Write([]byte(`{"docs":[` +
				completedTipJSON("tip-30", "4.2", "usd", "2025-02-19T15:07:09.302Z", "Styler", "Thanks") + `,` +
				completedTipJSON("tip-20", `"15.5"`, "EUR", "2025-02-19T14:00:00+02:00", "", "") +
				`],"total":3,"limit":100,"offset":0}`))
		case 2:
			if query.Get("offset") != "2" {
				t.Fatalf("second offset = %q", query.Get("offset"))
			}
			_, _ = writer.Write([]byte(`{"docs":[` +
				completedTipJSON("tip-10", "99", "RUB", "2025-02-18T11:30:00Z", "Old", "Message") +
				`],"total":3,"limit":100,"offset":2}`))
		default:
			t.Fatalf("unexpected history request %d", requests)
		}
	})
	client.PageDelay = 0
	client.now = func() time.Time {
		return time.Date(2025, 2, 20, 10, 30, 0, 123_000_000, time.UTC)
	}

	history, err := client.GetDonations(context.Background(), "access-token", testChannelID, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if requests != 2 || len(history.Donations) != 3 || history.Checkpoint == nil || *history.Checkpoint != "tip-30" {
		t.Fatalf("history = %#v after %d requests", history, requests)
	}
	first := history.Donations[0]
	if first.SourceDonationID != "tip-30" || first.Amount != "4.20" || first.Currency != "USD" ||
		first.SourceCreatedAt != "2025-02-19T15:07:09.302Z" ||
		!first.OccurredAt.Equal(time.Date(2025, 2, 19, 15, 7, 9, 302_000_000, time.UTC)) ||
		first.Author == nil || *first.Author != "Styler" || first.Message == nil || *first.Message != "Thanks" {
		t.Fatalf("first donation = %#v", first)
	}
	second := history.Donations[1]
	if second.Amount != "15.50" || second.Currency != "EUR" || !second.OccurredAt.Equal(time.Date(2025, 2, 19, 12, 0, 0, 0, time.UTC)) {
		t.Fatalf("second donation = %#v", second)
	}
}

func TestGetDonationsSupportsCurrentPaginationShape(t *testing.T) {
	requests := 0
	client := testClient(t, func(writer http.ResponseWriter, request *http.Request) {
		requests++
		switch requests {
		case 1:
			_, _ = writer.Write([]byte(`{"docs":[` + completedTipJSON("tip-2", "2", "USD", "2025-02-19T15:00:00Z", "New", "") + `],"totalDocs":2,"totalPages":2,"hasNextPage":true}`))
		case 2:
			if request.URL.Query().Get("offset") != "1" {
				t.Fatalf("second offset = %q", request.URL.Query().Get("offset"))
			}
			_, _ = writer.Write([]byte(`{"docs":[` + completedTipJSON("tip-1", "1", "USD", "2025-02-19T14:00:00Z", "Old", "") + `],"totalDocs":2,"totalPages":2,"hasNextPage":false}`))
		default:
			t.Fatalf("unexpected request %d", requests)
		}
	})
	client.PageDelay = 0

	history, err := client.GetDonations(context.Background(), "access-token", testChannelID, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if requests != 2 || len(history.Donations) != 2 {
		t.Fatalf("history = %#v after %d requests", history, requests)
	}
}

func TestGetDonationsFullReplayContinuesPastCheckpoint(t *testing.T) {
	checkpoint := "tip-20"
	requests := 0
	client := testClient(t, func(writer http.ResponseWriter, request *http.Request) {
		requests++
		if request.URL.Query().Has("after") {
			t.Fatalf("full replay unexpectedly has after: %v", request.URL.Query())
		}
		switch requests {
		case 1:
			_, _ = writer.Write([]byte(`{"docs":[` +
				completedTipJSON("tip-30", "3", "USD", "2025-02-19T15:00:00Z", "New", "") + `,` +
				completedTipJSON("tip-20", "2", "USD", "2025-02-19T14:00:00Z", "Seen", "") +
				`],"totalDocs":3,"hasNextPage":true}`))
		case 2:
			if request.URL.Query().Get("offset") != "2" {
				t.Fatalf("second offset = %q", request.URL.Query().Get("offset"))
			}
			_, _ = writer.Write([]byte(`{"docs":[` +
				completedTipJSON("tip-10", "1", "USD", "2025-02-19T13:00:00Z", "Old", "") +
				`],"totalDocs":3,"hasNextPage":false}`))
		default:
			t.Fatalf("unexpected request %d", requests)
		}
	})
	client.PageDelay = 0

	history, err := client.GetDonations(context.Background(), "access-token", testChannelID, &checkpoint, nil)
	if err != nil {
		t.Fatal(err)
	}
	ids := make([]string, len(history.Donations))
	for index, donation := range history.Donations {
		ids[index] = donation.SourceDonationID
	}
	if requests != 2 || !reflect.DeepEqual(ids, []string{"tip-30", "tip-20", "tip-10"}) ||
		history.Checkpoint != nil {
		t.Fatalf("history = %#v after %d requests", history, requests)
	}
}

func TestGetDonationsOverlapContinuesPastCheckpointForDelayedTip(t *testing.T) {
	checkpoint := "tip-head"
	cutoff := time.Date(2025, 2, 19, 12, 30, 0, 456_000_000, time.FixedZone("UTC+2", 2*60*60))
	requests := 0
	client := testClient(t, func(writer http.ResponseWriter, request *http.Request) {
		requests++
		query := request.URL.Query()
		if query.Get("after") != "2025-02-19T10:30:00.456Z" {
			t.Fatalf("after = %q; want normalized UTC cutoff", query.Get("after"))
		}
		if query.Get("before") != "2025-02-20T10:30:00Z" {
			t.Fatalf("before = %q; want one fixed traversal bound", query.Get("before"))
		}
		switch requests {
		case 1:
			if query.Get("offset") != "0" {
				t.Fatalf("first offset = %q", query.Get("offset"))
			}
			_, _ = writer.Write([]byte(`{"docs":[` +
				completedTipJSON("tip-new", "3", "USD", "2025-02-19T11:30:00Z", "New", "") + `,` +
				completedTipJSON("tip-head", "2", "USD", "2025-02-19T11:00:00Z", "Seen", "") +
				`],"totalDocs":3,"hasNextPage":true}`))
		case 2:
			if query.Get("offset") != "2" {
				t.Fatalf("second offset = %q", query.Get("offset"))
			}
			_, _ = writer.Write([]byte(`{"docs":[` +
				completedTipJSON("tip-delayed", "1", "USD", "2025-02-19T10:45:00Z", "Delayed", "") +
				`],"totalDocs":3,"hasNextPage":false}`))
		default:
			t.Fatalf("unexpected request %d", requests)
		}
	})
	client.PageDelay = 0
	client.now = func() time.Time {
		return time.Date(2025, 2, 20, 10, 30, 0, 0, time.UTC)
	}

	history, err := client.GetDonations(
		context.Background(),
		"access-token",
		testChannelID,
		&checkpoint,
		&cutoff,
	)
	if err != nil {
		t.Fatal(err)
	}
	ids := make([]string, len(history.Donations))
	for index, donation := range history.Donations {
		ids[index] = donation.SourceDonationID
	}
	want := []string{"tip-new", "tip-head", "tip-delayed"}
	if requests != 2 || !reflect.DeepEqual(ids, want) || history.Checkpoint != nil {
		t.Fatalf("history IDs = %v checkpoint=%v after %d requests; want %v and nil checkpoint", ids, history.Checkpoint, requests, want)
	}
}

func TestGetDonationsDoesNotFilterProviderStatusModerationOrDeletionFields(t *testing.T) {
	client := testClient(t, func(writer http.ResponseWriter, _ *http.Request) {
		pending := completedTipMap("pending", "1", "USD", "2025-02-19T15:00:00Z")
		pending["status"] = "pending"
		denied := completedTipMap("denied", "2", "USD", "2025-02-19T14:00:00Z")
		denied["approved"] = "denied"
		deleted := completedTipMap("deleted", "3", "USD", "2025-02-19T13:00:00Z")
		deleted["deleted"] = true
		body, err := json.Marshal(map[string]any{
			"docs":  []any{pending, denied, deleted, json.RawMessage(completedTipJSON("completed", "4", "USD", "2025-02-19T12:00:00Z", "Good", ""))},
			"total": 4,
		})
		if err != nil {
			t.Fatal(err)
		}
		_, _ = writer.Write(body)
	})
	client.PageDelay = 0

	history, err := client.GetDonations(context.Background(), "access-token", testChannelID, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(history.Donations) != 4 || history.Donations[0].SourceDonationID != "pending" ||
		history.Donations[1].SourceDonationID != "denied" || history.Donations[2].SourceDonationID != "deleted" ||
		history.Donations[3].SourceDonationID != "completed" ||
		history.Checkpoint == nil || *history.Checkpoint != "pending" {
		t.Fatalf("history = %#v", history)
	}
}

func TestGetDonationsReturnsNoCheckpointForEmptyReplay(t *testing.T) {
	checkpoint := "tip-previous"
	client := testClient(t, func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = writer.Write([]byte(`{"docs":[],"totalDocs":0,"hasNextPage":false}`))
	})
	history, err := client.GetDonations(context.Background(), "access-token", testChannelID, &checkpoint, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(history.Donations) != 0 || history.Checkpoint != nil {
		t.Fatalf("history = %#v", history)
	}
}

func TestGetDonationsRejectsInvalidCompletedTips(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(map[string]any)
	}{
		{name: "missing id", mutate: func(tip map[string]any) { delete(tip, "_id") }},
		{name: "wrong channel", mutate: func(tip map[string]any) { tip["channel"] = "another-channel" }},
		{name: "invalid currency", mutate: func(tip map[string]any) { donationMap(tip)["currency"] = "US" }},
		{name: "fractional precision", mutate: func(tip map[string]any) { donationMap(tip)["amount"] = "1.234" }},
		{name: "negative amount", mutate: func(tip map[string]any) { donationMap(tip)["amount"] = "-1" }},
		{name: "invalid date", mutate: func(tip map[string]any) { tip["createdAt"] = "yesterday" }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			client := testClient(t, func(writer http.ResponseWriter, _ *http.Request) {
				tip := completedTipMap("tip", "1", "USD", "2025-02-19T15:00:00Z")
				test.mutate(tip)
				body, err := json.Marshal(map[string]any{"docs": []any{tip}, "total": 1})
				if err != nil {
					t.Fatal(err)
				}
				_, _ = writer.Write(body)
			})
			client.PageDelay = 0
			_, err := client.GetDonations(context.Background(), "access-token", testChannelID, nil, nil)
			var requestError *RequestError
			if !errors.As(err, &requestError) || requestError.Unauthorized || !requestError.Permanent {
				t.Fatalf("error = %v; want permanent validation RequestError", err)
			}
		})
	}
}

func TestRESTUnauthorizedIsClassifiedWithoutLeakingAccessToken(t *testing.T) {
	client := testClient(t, func(writer http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "OAuth secret-access-token" {
			t.Fatalf("authorization = %q", request.Header.Get("Authorization"))
		}
		writer.WriteHeader(http.StatusUnauthorized)
	})
	_, err := client.GetDonations(context.Background(), "secret-access-token", testChannelID, nil, nil)
	var requestError *RequestError
	if !errors.As(err, &requestError) || !requestError.Unauthorized || requestError.Status != http.StatusUnauthorized {
		t.Fatalf("error = %v; want unauthorized RequestError", err)
	}
	if strings.Contains(err.Error(), "secret-access-token") {
		t.Fatalf("error leaked access token: %v", err)
	}
}

func TestRefreshInvalidGrantIsUnauthorizedWithoutExposingResponse(t *testing.T) {
	client := testClient(t, func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusBadRequest)
		_, _ = writer.Write([]byte(`{"error":"invalid_grant","error_description":"refresh token secret-refresh-token expired"}`))
	})
	_, err := client.RefreshTokens(context.Background(), Config{}, "secret-refresh-token")
	var requestError *RequestError
	if !errors.As(err, &requestError) || !requestError.Unauthorized || requestError.Status != http.StatusBadRequest {
		t.Fatalf("error = %v; want unauthorized invalid_grant RequestError", err)
	}
	for _, secret := range []string{"secret-refresh-token", "error_description"} {
		if strings.Contains(err.Error(), secret) {
			t.Fatalf("error leaked response detail %q: %v", secret, err)
		}
	}
}

func TestOtherTokenHTTP400IsPermanentAndNotUnauthorized(t *testing.T) {
	client := testClient(t, func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusBadRequest)
		_, _ = writer.Write([]byte(`{"error":"invalid_client"}`))
	})
	_, err := client.RefreshTokens(context.Background(), Config{}, "refresh-token")
	var requestError *RequestError
	if !errors.As(err, &requestError) || requestError.Unauthorized || !requestError.Permanent ||
		requestError.Status != http.StatusBadRequest {
		t.Fatalf("error = %v; want permanent HTTP 400 RequestError", err)
	}
}

func TestRateLimitAndServerFailuresRemainRetryable(t *testing.T) {
	for _, status := range []int{http.StatusTooManyRequests, http.StatusInternalServerError} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			client := testClient(t, func(writer http.ResponseWriter, _ *http.Request) {
				writer.WriteHeader(status)
			})
			_, err := client.GetDonations(
				context.Background(),
				"access-token",
				testChannelID,
				nil,
				nil,
			)
			var requestError *RequestError
			if !errors.As(err, &requestError) || requestError.Unauthorized || requestError.Permanent ||
				requestError.Status != status {
				t.Fatalf("error = %v; want retryable HTTP %d RequestError", err, status)
			}
		})
	}
}

func TestGetDonationsRejectsInvalidJSONAndMissingChannel(t *testing.T) {
	client := testClient(t, func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = writer.Write([]byte(`{"docs":`))
	})
	for _, channelID := range []string{testChannelID, ""} {
		_, err := client.GetDonations(context.Background(), "access-token", channelID, nil, nil)
		var requestError *RequestError
		if !errors.As(err, &requestError) {
			t.Fatalf("channel %q error = %v; want RequestError", channelID, err)
		}
	}
}

func TestWaitContextHonorsCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := waitContext(ctx, time.Hour); !errors.Is(err, context.Canceled) {
		t.Fatalf("wait error = %v; want context cancellation", err)
	}
	if err := waitContext(context.Background(), 0); err != nil {
		t.Fatalf("zero wait error = %v", err)
	}
}

func completedTipJSON(id, amountJSON, currency, createdAt, username, message string) string {
	tip := completedTipMap(id, amountJSON, currency, createdAt)
	donationMap(tip)["user"] = map[string]any{"username": username, "geo": "ZZ", "email": "tipper@example.test", "channel": testChannelID}
	donationMap(tip)["message"] = message
	body, err := json.Marshal(tip)
	if err != nil {
		panic(err)
	}
	// A quoted amount is passed as JSON syntax so tests cover both documented numbers and legacy strings.
	if strings.HasPrefix(amountJSON, `"`) {
		body = []byte(strings.Replace(string(body), `"amount":"`+strings.Trim(amountJSON, `"`)+`"`, `"amount":`+amountJSON, 1))
	}
	return string(body)
}

func completedTipMap(id, amount, currency, createdAt string) map[string]any {
	var amountValue any = json.Number(amount)
	if strings.HasPrefix(amount, `"`) {
		amountValue = strings.Trim(amount, `"`)
	}
	return map[string]any{
		"_id":           id,
		"channel":       testChannelID,
		"provider":      "paypal",
		"approved":      "allowed",
		"status":        "success",
		"deleted":       false,
		"createdAt":     createdAt,
		"updatedAt":     createdAt,
		"transactionId": "transaction-" + id,
		"donation": map[string]any{
			"user":          map[string]any{"username": "Tipper"},
			"message":       "Thank you",
			"amount":        amountValue,
			"currency":      currency,
			"paymentMethod": "scheme",
		},
	}
}

func donationMap(tip map[string]any) map[string]any {
	donation, ok := tip["donation"].(map[string]any)
	if !ok {
		panic("completed tip fixture has no donation object")
	}
	return donation
}

func testClient(t *testing.T, handler http.HandlerFunc) *Client {
	t.Helper()
	httpClient := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)
		return recorder.Result(), nil
	})}
	client := NewClient(httpClient)
	client.BaseURL = "https://streamelements.test"
	return client
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (function roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

func TestCompletedTipFixtureIsValidJSON(t *testing.T) {
	for _, amount := range []string{"4.2", `"15.5"`} {
		var value any
		body := completedTipJSON("tip", amount, "USD", "2025-02-19T15:00:00Z", "Tipper", "Thanks")
		if err := json.Unmarshal([]byte(body), &value); err != nil {
			t.Fatalf("fixture %s: %v", body, err)
		}
	}
}

func TestRequestErrorUnwrapsCause(t *testing.T) {
	cause := errors.New("cause")
	err := &RequestError{Authorized: true, Operation: "operation", Cause: cause}
	if !errors.Is(err, cause) || err.Error() != fmt.Sprintf("streamelements: operation: %v", cause) {
		t.Fatalf("error = %v", err)
	}
	var authorizedSession interface {
		HadAuthorizedSession() bool
	}
	if wrapped := fmt.Errorf("outer: %w", err); !errors.As(wrapped, &authorizedSession) ||
		!authorizedSession.HadAuthorizedSession() {
		t.Fatalf("wrapped RequestError does not expose its authorized-session state")
	}
}
