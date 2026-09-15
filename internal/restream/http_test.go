package restream

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

type fakeControlPlane struct {
	mu             sync.Mutex
	authorization  Authorization
	authorizeError error
	authorizations int
	heartbeats     [][]DestinationState
	ended          []string
}

func (control *fakeControlPlane) Authorize(context.Context, string, string, string) (Authorization, error) {
	control.mu.Lock()
	control.authorizations++
	control.mu.Unlock()
	return control.authorization, control.authorizeError
}

func (control *fakeControlPlane) Heartbeat(_ context.Context, _ string, _ string, states []DestinationState) error {
	control.mu.Lock()
	defer control.mu.Unlock()
	control.heartbeats = append(control.heartbeats, states)
	return nil
}

func (control *fakeControlPlane) End(_ context.Context, _ string, sessionID string) error {
	control.mu.Lock()
	defer control.mu.Unlock()
	control.ended = append(control.ended, sessionID)
	return nil
}

type fakeMediaServer struct {
	configured []Destination
	statuses   []ForwardStatus
	deleted    []string
}

func (media *fakeMediaServer) Configure(_ context.Context, _ string, destinations []Destination) error {
	media.configured = destinations
	return nil
}

func (media *fakeMediaServer) ForwardStatuses(context.Context, string) ([]ForwardStatus, error) {
	return media.statuses, nil
}

func (media *fakeMediaServer) Delete(_ context.Context, path string) error {
	media.deleted = append(media.deleted, path)
	return nil
}

func postJSON(handler http.Handler, path string, input any) *httptest.ResponseRecorder {
	body, _ := json.Marshal(input)
	request := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(body))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func TestHTTPHandlerAuthorizesAndConfiguresPublisher(t *testing.T) {
	control := &fakeControlPlane{authorization: Authorization{
		SessionID:    "session-1",
		Destinations: []Destination{{ID: "destination-1", TargetURL: "rtmp://8.8.8.8/app#key"}},
	}}
	media := &fakeMediaServer{}
	handler := NewHTTPHandler(control, media, "fsn1-1").Handler()

	response := postJSON(handler, "/v1/auth", map[string]string{
		"action": "publish", "protocol": "rtmp", "id": "publisher-1", "path": "sb_" + string(bytes.Repeat([]byte{'a'}, 43)),
	})

	if response.Code != http.StatusNoContent || len(media.configured) != 1 {
		t.Fatalf("status = %d, configured = %#v", response.Code, media.configured)
	}
}

func TestHTTPHandlerDeniesReadsAndUnknownPublishers(t *testing.T) {
	control := &fakeControlPlane{authorizeError: ErrPublisherNotAuthorized}
	handler := NewHTTPHandler(control, &fakeMediaServer{}, "fsn1-1").Handler()
	path := "sb_" + string(bytes.Repeat([]byte{'a'}, 43))

	read := postJSON(handler, "/v1/auth", map[string]string{
		"action": "read", "protocol": "rtmp", "id": "reader-1", "path": path,
	})
	unknown := postJSON(handler, "/v1/auth", map[string]string{
		"action": "publish", "protocol": "rtmp", "id": "publisher-1", "path": path,
	})

	if read.Code != http.StatusForbidden || unknown.Code != http.StatusForbidden {
		t.Fatalf("read = %d, unknown = %d", read.Code, unknown.Code)
	}
}

func TestHTTPHandlerRejectsASecondPublisherForTheSameIngest(t *testing.T) {
	control := &fakeControlPlane{authorization: Authorization{
		SessionID:    "session-1",
		Destinations: []Destination{{ID: "destination-1", TargetURL: "rtmp://8.8.8.8/app#key"}},
	}}
	handler := NewHTTPHandler(control, &fakeMediaServer{}, "fsn1-1").Handler()
	path := "sb_" + string(bytes.Repeat([]byte{'a'}, 43))
	input := map[string]string{
		"action": "publish", "protocol": "rtmp", "id": "publisher-1", "path": path,
	}

	first := postJSON(handler, "/v1/auth", input)
	second := postJSON(handler, "/v1/auth", input)

	control.mu.Lock()
	defer control.mu.Unlock()
	if first.Code != http.StatusNoContent || second.Code != http.StatusConflict || control.authorizations != 1 {
		t.Fatalf("first = %d, second = %d, authorizations = %d", first.Code, second.Code, control.authorizations)
	}
}

func TestHTTPHandlerRejectsPrivateForwardAndEndsAuthorization(t *testing.T) {
	control := &fakeControlPlane{authorization: Authorization{
		SessionID:    "session-1",
		Destinations: []Destination{{ID: "destination-1", TargetURL: "rtmp://127.0.0.1/app#key"}},
	}}
	media := &fakeMediaServer{}
	handler := NewHTTPHandler(control, media, "fsn1-1").Handler()

	response := postJSON(handler, "/v1/auth", map[string]string{
		"action": "publish", "protocol": "rtmp", "id": "publisher-1", "path": "sb_" + string(bytes.Repeat([]byte{'a'}, 43)),
	})

	if response.Code != http.StatusServiceUnavailable || len(control.ended) != 1 || len(media.configured) != 0 {
		t.Fatalf("status = %d, ended = %#v, configured = %#v", response.Code, control.ended, media.configured)
	}
}

func TestHTTPHandlerReportsForwardStateAndEndsOfflineSession(t *testing.T) {
	control := &fakeControlPlane{authorization: Authorization{
		SessionID:    "session-1",
		Destinations: []Destination{{ID: "destination-1", TargetURL: "rtmp://8.8.8.8/app#key"}},
	}}
	media := &fakeMediaServer{statuses: []ForwardStatus{{Position: 0, State: "forwarding", OutboundBytes: 2048}}}
	handler := NewHTTPHandler(control, media, "fsn1-1")
	handler.heartbeatInterval = time.Hour
	server := handler.Handler()
	path := "sb_" + string(bytes.Repeat([]byte{'a'}, 43))
	if response := postJSON(server, "/v1/auth", map[string]string{
		"action": "publish", "protocol": "rtmp", "id": "publisher-1", "path": path,
	}); response.Code != http.StatusNoContent {
		t.Fatalf("authorize status = %d", response.Code)
	}
	if response := postJSON(server, "/v1/hooks/online", map[string]string{"path": path}); response.Code != http.StatusNoContent {
		t.Fatalf("online status = %d", response.Code)
	}
	deadline := time.Now().Add(time.Second)
	for {
		control.mu.Lock()
		count := len(control.heartbeats)
		control.mu.Unlock()
		if count > 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("heartbeat was not sent")
		}
		time.Sleep(time.Millisecond)
	}
	if response := postJSON(server, "/v1/hooks/offline", map[string]string{"path": path}); response.Code != http.StatusNoContent {
		t.Fatalf("offline status = %d", response.Code)
	}

	control.mu.Lock()
	defer control.mu.Unlock()
	if len(control.heartbeats) != 1 || control.heartbeats[0][0].State != "forwarding" || len(control.ended) != 1 || len(media.deleted) != 1 {
		t.Fatalf("heartbeats = %#v, ended = %#v, deleted = %#v", control.heartbeats, control.ended, media.deleted)
	}
}

func TestHTTPHandlerReturnsUnavailableWhenControlPlaneFails(t *testing.T) {
	control := &fakeControlPlane{authorizeError: errors.New("network unavailable")}
	handler := NewHTTPHandler(control, &fakeMediaServer{}, "fsn1-1").Handler()
	response := postJSON(handler, "/v1/auth", map[string]string{
		"action": "publish", "protocol": "rtmp", "id": "publisher-1", "path": "sb_" + string(bytes.Repeat([]byte{'a'}, 43)),
	})
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d", response.Code)
	}
}
