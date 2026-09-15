package restream

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"sync"
	"time"
)

const maxSafeJSONInteger = 9_007_199_254_740_991

var ingestPathPattern = regexp.MustCompile(`^sb_[A-Za-z0-9_-]{43}$`)

type activeSession struct {
	authorization Authorization
	cancel        context.CancelFunc
}

type HTTPHandler struct {
	control           ControlPlane
	media             MediaServer
	nodeID            string
	heartbeatInterval time.Duration
	mu                sync.Mutex
	sessions          map[string]activeSession
	pending           map[string]struct{}
}

func NewHTTPHandler(control ControlPlane, media MediaServer, nodeID string) *HTTPHandler {
	return &HTTPHandler{
		control: control, media: media, nodeID: nodeID, heartbeatInterval: 5 * time.Second,
		sessions: make(map[string]activeSession), pending: make(map[string]struct{}),
	}
}

func (handler *HTTPHandler) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(response http.ResponseWriter, _ *http.Request) {
		response.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("POST /v1/auth", handler.authorize)
	mux.HandleFunc("POST /v1/hooks/online", handler.online)
	mux.HandleFunc("POST /v1/hooks/offline", handler.offline)
	return mux
}

func (handler *HTTPHandler) authorize(response http.ResponseWriter, request *http.Request) {
	var input struct {
		User      string `json:"user"`
		Password  string `json:"password"`
		Token     string `json:"token"`
		IP        string `json:"ip"`
		Action    string `json:"action"`
		Path      string `json:"path"`
		Protocol  string `json:"protocol"`
		ID        string `json:"id"`
		Query     string `json:"query"`
		UserAgent string `json:"userAgent"`
	}
	if !decodeJSON(response, request, &input) {
		return
	}
	if input.Action != "publish" || input.Protocol != "rtmp" || input.ID == "" || !ingestPathPattern.MatchString(input.Path) {
		http.Error(response, "publisher not authorized", http.StatusForbidden)
		return
	}
	handler.mu.Lock()
	_, active := handler.sessions[input.Path]
	_, pending := handler.pending[input.Path]
	if !active && !pending {
		handler.pending[input.Path] = struct{}{}
	}
	handler.mu.Unlock()
	if active || pending {
		http.Error(response, "publisher already connected", http.StatusConflict)
		return
	}
	defer func() {
		handler.mu.Lock()
		delete(handler.pending, input.Path)
		handler.mu.Unlock()
	}()
	authorization, err := handler.control.Authorize(request.Context(), handler.nodeID, input.ID, input.Path)
	if errors.Is(err, ErrPublisherNotAuthorized) {
		http.Error(response, "publisher not authorized", http.StatusForbidden)
		return
	}
	if err != nil {
		slog.WarnContext(request.Context(), "Authorize restream publisher", "error", err)
		http.Error(response, "control plane unavailable", http.StatusServiceUnavailable)
		return
	}
	for _, destination := range authorization.Destinations {
		if err := ValidateTargetURL(request.Context(), destination.TargetURL); err != nil {
			slog.WarnContext(request.Context(), "Reject unsafe restream destination", "destinationId", destination.ID, "error", err)
			handler.endAuthorization(request.Context(), authorization.SessionID)
			http.Error(response, "invalid destination", http.StatusServiceUnavailable)
			return
		}
	}
	if err := handler.media.Configure(request.Context(), input.Path, authorization.Destinations); err != nil {
		slog.WarnContext(request.Context(), "Configure restream forwards", "error", err)
		handler.endAuthorization(request.Context(), authorization.SessionID)
		http.Error(response, "media server unavailable", http.StatusServiceUnavailable)
		return
	}

	handler.mu.Lock()
	handler.sessions[input.Path] = activeSession{authorization: authorization}
	handler.mu.Unlock()
	response.WriteHeader(http.StatusNoContent)
}

func (handler *HTTPHandler) online(response http.ResponseWriter, request *http.Request) {
	path, ok := decodeHookPath(response, request)
	if !ok {
		return
	}
	handler.mu.Lock()
	session, found := handler.sessions[path]
	if !found {
		handler.mu.Unlock()
		http.Error(response, "restream session not found", http.StatusNotFound)
		return
	}
	if session.cancel != nil {
		session.cancel()
	}
	ctx, cancel := context.WithCancel(context.WithoutCancel(request.Context()))
	session.cancel = cancel
	handler.sessions[path] = session
	handler.mu.Unlock()
	go handler.runHeartbeats(ctx, path, session.authorization)
	response.WriteHeader(http.StatusNoContent)
}

func (handler *HTTPHandler) offline(response http.ResponseWriter, request *http.Request) {
	path, ok := decodeHookPath(response, request)
	if !ok {
		return
	}
	handler.mu.Lock()
	session, found := handler.sessions[path]
	if found {
		delete(handler.sessions, path)
		if session.cancel != nil {
			session.cancel()
		}
	}
	handler.mu.Unlock()
	if !found {
		response.WriteHeader(http.StatusNoContent)
		return
	}
	ctx, cancel := context.WithTimeout(request.Context(), 10*time.Second)
	defer cancel()
	if err := handler.media.Delete(ctx, path); err != nil {
		slog.WarnContext(ctx, "Delete restream media path", "error", err)
	}
	if err := handler.control.End(ctx, handler.nodeID, session.authorization.SessionID); err != nil && !errors.Is(err, ErrSessionNotFound) {
		slog.WarnContext(ctx, "End restream session", "error", err)
	}
	response.WriteHeader(http.StatusNoContent)
}

func (handler *HTTPHandler) runHeartbeats(ctx context.Context, path string, authorization Authorization) {
	ticker := time.NewTicker(handler.heartbeatInterval)
	defer ticker.Stop()
	for {
		if !handler.sendHeartbeat(ctx, path, authorization) {
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (handler *HTTPHandler) sendHeartbeat(ctx context.Context, path string, authorization Authorization) bool {
	statuses, err := handler.media.ForwardStatuses(ctx, path)
	if err != nil {
		if ctx.Err() == nil {
			slog.WarnContext(ctx, "Read restream forward state", "error", err)
		}
		return ctx.Err() == nil
	}
	states := make([]DestinationState, len(authorization.Destinations))
	for position, destination := range authorization.Destinations {
		states[position] = DestinationState{DestinationID: destination.ID, State: "idle"}
	}
	for _, status := range statuses {
		if status.Position < 0 || status.Position >= len(states) {
			continue
		}
		state := status.State
		if state != "idle" && state != "forwarding" && state != "error" {
			state = "error"
		}
		outboundBytes := status.OutboundBytes
		if outboundBytes > maxSafeJSONInteger {
			outboundBytes = maxSafeJSONInteger
		}
		states[status.Position].State = state
		states[status.Position].OutboundBytes = outboundBytes
	}
	if err := handler.control.Heartbeat(ctx, handler.nodeID, authorization.SessionID, states); err != nil {
		if !errors.Is(err, ErrSessionNotFound) && ctx.Err() == nil {
			slog.WarnContext(ctx, "Send restream heartbeat", "error", err)
		}
		return !errors.Is(err, ErrSessionNotFound) && ctx.Err() == nil
	}
	return true
}

func (handler *HTTPHandler) endAuthorization(parent context.Context, sessionID string) {
	ctx, cancel := context.WithTimeout(parent, 10*time.Second)
	defer cancel()
	if err := handler.control.End(ctx, handler.nodeID, sessionID); err != nil && !errors.Is(err, ErrSessionNotFound) {
		slog.WarnContext(ctx, "Roll back restream authorization", "error", err)
	}
}

func decodeHookPath(response http.ResponseWriter, request *http.Request) (string, bool) {
	var input struct {
		Path string `json:"path"`
	}
	if !decodeJSON(response, request, &input) {
		return "", false
	}
	if !ingestPathPattern.MatchString(input.Path) {
		http.Error(response, "invalid restream path", http.StatusBadRequest)
		return "", false
	}
	return input.Path, true
}

func decodeJSON(response http.ResponseWriter, request *http.Request, output any) bool {
	request.Body = http.MaxBytesReader(response, request.Body, 16*1024)
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(output); err != nil {
		http.Error(response, "invalid request", http.StatusBadRequest)
		return false
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		http.Error(response, "invalid request", http.StatusBadRequest)
		return false
	}
	return true
}
