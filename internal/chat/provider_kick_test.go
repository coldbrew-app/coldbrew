package chat

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"testing"
)

func TestKickProviderRoundsTimeoutUpToMinutes(t *testing.T) {
	var body map[string]any
	client := &http.Client{Transport: oauthRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		return &http.Response{StatusCode: http.StatusNoContent, Body: io.NopCloser(&emptyReader{}), Header: make(http.Header)}, nil
	})}
	provider := NewKickProvider(client)
	source := connectedSource(youtubeSourceID, "kick", CapabilityTimeoutUser)
	source.Source.ProviderSourceID = "42"
	source.Credentials.AccessToken = "access-token"
	_, err := provider.Moderate(context.Background(), source, ModerationCommand{Type: "timeout_user", SourceID: source.Source.SourceID, ProviderUserID: "123", DurationSeconds: 61}, "")
	if err != nil {
		t.Fatal(err)
	}
	if body["broadcaster_user_id"] != float64(42) || body["user_id"] != float64(123) || body["duration"] != float64(2) {
		t.Fatalf("unexpected timeout body: %#v", body)
	}
}

func TestKickProviderClassifiesUnauthorized(t *testing.T) {
	client := &http.Client{Transport: oauthRoundTripFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: http.StatusUnauthorized, Body: io.NopCloser(&emptyReader{}), Header: make(http.Header)}, nil
	})}
	provider := NewKickProvider(client)
	source := connectedSource(youtubeSourceID, "kick", CapabilitySendMessage)
	source.Source.ProviderSourceID = "42"
	source.Credentials.AccessToken = "access-token"
	err := provider.SendMessage(context.Background(), source, "hello")
	providerError, ok := err.(*ProviderError)
	if !ok || providerError.Type != "provider unauthorized" {
		t.Fatalf("expected unauthorized provider error, got %v", err)
	}
}

type emptyReader struct{}

func (*emptyReader) Read([]byte) (int, error) { return 0, io.EOF }
