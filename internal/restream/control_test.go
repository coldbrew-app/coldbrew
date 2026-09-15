package restream

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestControlClientAuthorizesWithSharedSecret(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer shared-secret" {
			t.Error("missing shared secret")
		}
		var input map[string]any
		if err := json.NewDecoder(request.Body).Decode(&input); err != nil {
			t.Fatal(err)
		}
		if input["nodeId"] != "fsn1-1" || input["path"] != "stream-path" {
			t.Errorf("unexpected input: %#v", input)
		}
		_ = json.NewEncoder(response).Encode(Authorization{
			SessionID:    "session-1",
			Destinations: []Destination{{ID: "destination-1", TargetURL: "rtmp://8.8.8.8/app#key"}},
		})
	}))
	defer server.Close()
	client := NewControlClient(server.URL, "shared-secret", server.Client())

	result, err := client.Authorize(context.Background(), "fsn1-1", "publisher-1", "stream-path")
	if err != nil || result.SessionID != "session-1" {
		t.Fatalf("Authorize() = %#v, %v", result, err)
	}
}

func TestControlClientMapsDeniedPublisher(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.WriteHeader(http.StatusForbidden)
	}))
	defer server.Close()
	client := NewControlClient(server.URL, "shared-secret", server.Client())

	_, err := client.Authorize(context.Background(), "fsn1-1", "publisher-1", "stream-path")
	if !errors.Is(err, ErrPublisherNotAuthorized) {
		t.Fatalf("Authorize() error = %v", err)
	}
}
