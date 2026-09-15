package restream

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMediaMTXClientConfiguresNativeForward(t *testing.T) {
	var method, path string
	var payload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		method, path = request.Method, request.URL.Path
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		response.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	client := NewMediaMTXClient(server.URL, server.Client())

	err := client.Configure(context.Background(), "sb_stream-key", []Destination{
		{ID: "destination-1", TargetURL: "rtmps://8.8.8.8/app#secret"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if method != http.MethodPatch || path != "/v3/config/paths/patch/sb_stream-key" {
		t.Fatalf("request = %s %s", method, path)
	}
	if payload["source"] != "publisher" || payload["overridePublisher"] != false {
		t.Fatalf("payload = %#v", payload)
	}
	forward, ok := payload["forward"].([]any)
	if !ok || len(forward) != 1 {
		t.Fatalf("forward payload = %#v", payload["forward"])
	}
	forwardDestination, ok := forward[0].(map[string]any)
	if !ok || forwardDestination["dest"] != "rtmps://8.8.8.8/app#secret" {
		t.Fatalf("forward payload = %#v", payload["forward"])
	}
}

func TestMediaMTXClientReadsForwardStateWithoutLastError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		_, _ = response.Write([]byte(`{"items":[{"pos":0,"state":"forwarding","outboundBytes":2048,"lastError":"rtmp://host/app#secret"}]}`))
	}))
	defer server.Close()
	client := NewMediaMTXClient(server.URL, server.Client())

	statuses, err := client.ForwardStatuses(context.Background(), "sb_stream-key")
	if err != nil {
		t.Fatal(err)
	}
	if len(statuses) != 1 || statuses[0].State != "forwarding" || statuses[0].OutboundBytes != 2048 {
		t.Fatalf("ForwardStatuses() = %#v", statuses)
	}
}
