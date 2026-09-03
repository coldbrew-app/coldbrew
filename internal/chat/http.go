package chat

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

type ChatAPI interface {
	Config(context.Context, int) (Config, error)
	Stream(context.Context, int) <-chan StreamEvent
	RefreshSource(context.Context, int, string) error
	Broadcast(context.Context, int, string) (BroadcastResult, error)
	Moderate(context.Context, int, ModerationCommand) (CommandResult, error)
}

type HTTPOauth interface {
	Available(string) bool
	Start(context.Context, int, string, string) (string, error)
	Finish(context.Context, string, string) (string, error)
}

type HTTPStore interface {
	Disconnect(context.Context, int, string) error
}

type HTTPHandler struct {
	application   ChatAPI
	oauth         HTTPOauth
	store         HTTPStore
	serviceSecret string
	webURL        string
	kickWebhook   *KickWebhookHandler
}

func NewHTTPHandler(application ChatAPI, oauth HTTPOauth, store HTTPStore, serviceSecret, webURL string, kickWebhook *KickWebhookHandler) *HTTPHandler {
	return &HTTPHandler{application: application, oauth: oauth, store: store, serviceSecret: serviceSecret, webURL: webURL, kickWebhook: kickWebhook}
}

func (handler *HTTPHandler) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	if request.URL.Path == "/health" {
		writeJSON(response, http.StatusOK, map[string]string{"status": "ok"})
		return
	}
	if !handler.authenticated(request) {
		writeError(response, http.StatusUnauthorized, "unauthorized")
		return
	}

	switch {
	case request.URL.Path == "/webhooks/kick" && request.Method == http.MethodPost:
		handler.handleKickWebhook(response, request)
	case strings.HasPrefix(request.URL.Path, "/oauth/") && strings.HasSuffix(request.URL.Path, "/callback") && request.Method == http.MethodGet:
		handler.handleOauthCallback(response, request)
	case request.URL.Path == "/internal/config" && request.Method == http.MethodPost:
		handler.handleConfig(response, request)
	case request.URL.Path == "/internal/provider-availability" && request.Method == http.MethodGet:
		writeJSON(response, http.StatusOK, handler.providerAvailability())
	case request.URL.Path == "/internal/oauth/start" && request.Method == http.MethodPost:
		handler.handleStartOauth(response, request)
	case request.URL.Path == "/internal/connections/disconnect" && request.Method == http.MethodPost:
		handler.handleDisconnect(response, request)
	case request.URL.Path == "/internal/sources/refresh" && request.Method == http.MethodPost:
		handler.handleRefreshSource(response, request)
	case request.URL.Path == "/internal/broadcast" && request.Method == http.MethodPost:
		handler.handleBroadcast(response, request)
	case request.URL.Path == "/internal/moderate" && request.Method == http.MethodPost:
		handler.handleModerate(response, request)
	case request.URL.Path == "/internal/stream" && request.Method == http.MethodGet:
		handler.handleStream(response, request)
	default:
		http.NotFound(response, request)
	}
}

func (handler *HTTPHandler) authenticated(request *http.Request) bool {
	received := request.Header.Get("Authorization")
	expected := "Bearer " + handler.serviceSecret
	return len(received) == len(expected) && subtle.ConstantTimeCompare([]byte(received), []byte(expected)) == 1
}

type userInput struct {
	UserID int `json:"userId"`
}

func decodeInput(response http.ResponseWriter, request *http.Request, value any) bool {
	decoder := json.NewDecoder(http.MaxBytesReader(response, request.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		writeError(response, http.StatusBadRequest, "invalid request")
		return false
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		writeError(response, http.StatusBadRequest, "invalid request")
		return false
	}
	return true
}

func validUserID(response http.ResponseWriter, userID int) bool {
	if userID <= 0 {
		writeError(response, http.StatusBadRequest, "invalid user id")
		return false
	}
	return true
}

func (handler *HTTPHandler) handleConfig(response http.ResponseWriter, request *http.Request) {
	var input userInput
	if !decodeInput(response, request, &input) || !validUserID(response, input.UserID) {
		return
	}
	value, err := handler.application.Config(request.Context(), input.UserID)
	writeResult(response, value, err)
}

func (handler *HTTPHandler) handleStartOauth(response http.ResponseWriter, request *http.Request) {
	var input struct {
		UserID   int    `json:"userId"`
		Provider string `json:"provider"`
	}
	if !decodeInput(response, request, &input) || !validUserID(response, input.UserID) {
		return
	}
	if input.Provider != "youtube" && input.Provider != "twitch" && input.Provider != "kick" {
		writeError(response, http.StatusBadRequest, "invalid OAuth provider")
		return
	}
	returnURL := strings.TrimSuffix(handler.webURL, "/") + "/chat"
	authorizationURL, err := handler.oauth.Start(request.Context(), input.UserID, input.Provider, returnURL)
	writeResult(response, map[string]string{"authorizationUrl": authorizationURL}, err)
}

var uuidPattern = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

func validUUID(value string) bool { return uuidPattern.MatchString(value) }

func (handler *HTTPHandler) handleDisconnect(response http.ResponseWriter, request *http.Request) {
	var input struct {
		UserID       int    `json:"userId"`
		ConnectionID string `json:"connectionId"`
	}
	if !decodeInput(response, request, &input) || !validUserID(response, input.UserID) {
		return
	}
	if !validUUID(input.ConnectionID) {
		writeError(response, http.StatusBadRequest, "invalid connection id")
		return
	}
	writeResult(response, nil, handler.store.Disconnect(request.Context(), input.UserID, input.ConnectionID))
}

func (handler *HTTPHandler) handleRefreshSource(response http.ResponseWriter, request *http.Request) {
	var input struct {
		UserID   int    `json:"userId"`
		SourceID string `json:"sourceId"`
	}
	if !decodeInput(response, request, &input) || !validUserID(response, input.UserID) {
		return
	}
	if !validUUID(input.SourceID) {
		writeError(response, http.StatusBadRequest, "invalid source id")
		return
	}
	writeResult(response, nil, handler.application.RefreshSource(request.Context(), input.UserID, input.SourceID))
}

func (handler *HTTPHandler) handleBroadcast(response http.ResponseWriter, request *http.Request) {
	var input struct {
		UserID int    `json:"userId"`
		Text   string `json:"text"`
	}
	if !decodeInput(response, request, &input) || !validUserID(response, input.UserID) {
		return
	}
	if len([]rune(input.Text)) > MaxChatMessageLength {
		writeError(response, http.StatusBadRequest, "invalid chat message")
		return
	}
	value, err := handler.application.Broadcast(request.Context(), input.UserID, input.Text)
	writeResult(response, value, err)
}

func (handler *HTTPHandler) handleModerate(response http.ResponseWriter, request *http.Request) {
	var input struct {
		UserID  int               `json:"userId"`
		Command ModerationCommand `json:"command"`
	}
	if !decodeInput(response, request, &input) || !validUserID(response, input.UserID) {
		return
	}
	if err := input.Command.Validate(); err != nil {
		writeError(response, http.StatusBadRequest, err.Error())
		return
	}
	value, err := handler.application.Moderate(request.Context(), input.UserID, input.Command)
	writeResult(response, value, err)
}

func (handler *HTTPHandler) handleStream(response http.ResponseWriter, request *http.Request) {
	userID, err := strconv.Atoi(request.URL.Query().Get("userId"))
	if err != nil || userID <= 0 {
		writeError(response, http.StatusBadRequest, "invalid user id")
		return
	}
	flusher, ok := response.(http.Flusher)
	if !ok {
		writeError(response, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	response.Header().Set("Content-Type", "application/x-ndjson")
	response.Header().Set("Cache-Control", "no-cache")
	response.Header().Set("X-Accel-Buffering", "no")
	response.WriteHeader(http.StatusOK)
	flusher.Flush()
	encoder := json.NewEncoder(response)
	for event := range handler.application.Stream(request.Context(), userID) {
		if err := encoder.Encode(event); err != nil {
			return
		}
		flusher.Flush()
	}
}

func (handler *HTTPHandler) handleKickWebhook(response http.ResponseWriter, request *http.Request) {
	if handler.kickWebhook == nil {
		writeError(response, http.StatusServiceUnavailable, "Kick integration is unavailable")
		return
	}
	body, err := io.ReadAll(request.Body)
	if err != nil {
		writeError(response, http.StatusBadRequest, "invalid request")
		return
	}
	err = handler.kickWebhook.Handle(request.Context(), request.Header, string(body))
	if err == nil {
		response.WriteHeader(http.StatusNoContent)
		return
	}
	status := http.StatusUnauthorized
	var webhookError *KickWebhookError
	if errors.As(err, &webhookError) && webhookError.Type == "unknown kick source" {
		status = http.StatusAccepted
	}
	slog.Warn("Kick webhook rejected", "error", err)
	http.Error(response, err.Error(), status)
}

func (handler *HTTPHandler) handleOauthCallback(response http.ResponseWriter, request *http.Request) {
	provider := strings.TrimSuffix(strings.TrimPrefix(request.URL.Path, "/oauth/"), "/callback")
	if provider != "youtube" && provider != "twitch" && provider != "kick" {
		http.NotFound(response, request)
		return
	}
	returnURL, err := handler.oauth.Finish(request.Context(), provider, absoluteRequestURL(request))
	status := "success"
	oauthErrorType := ""
	if err != nil {
		status = "error"
		var oauthError *OauthError
		if errors.As(err, &oauthError) {
			oauthErrorType = oauthError.Type
			if oauthError.ReturnURL != "" {
				returnURL = oauthError.ReturnURL
			}
		} else {
			oauthErrorType = "unknown"
		}
		if returnURL == "" {
			returnURL = strings.TrimSuffix(handler.webURL, "/") + "/chat"
		}
		slog.Error("OAuth callback failed", "provider", provider, "error", err)
	}
	redirect, parseErr := url.Parse(returnURL)
	if parseErr != nil {
		writeError(response, http.StatusInternalServerError, "invalid return URL")
		return
	}
	query := redirect.Query()
	query.Set("chat_oauth", status)
	if oauthErrorType == "" {
		query.Del("chat_oauth_error")
	} else {
		query.Set("chat_oauth_error", oauthErrorType)
	}
	redirect.RawQuery = query.Encode()
	http.Redirect(response, request, redirect.String(), http.StatusFound)
}

func absoluteRequestURL(request *http.Request) string {
	value := *request.URL
	value.Path = strings.TrimSuffix(request.Header.Get("X-Forwarded-Prefix"), "/") + value.Path
	value.Scheme = request.Header.Get("X-Forwarded-Proto")
	if value.Scheme == "" {
		value.Scheme = "http"
		if request.TLS != nil {
			value.Scheme = "https"
		}
	}
	value.Host = request.Header.Get("X-Forwarded-Host")
	if value.Host == "" {
		value.Host = request.Host
	}
	return value.String()
}

func (handler *HTTPHandler) providerAvailability() []map[string]string {
	result := make([]map[string]string, 0, 5)
	for _, provider := range []string{"youtube", "twitch", "kick"} {
		item := map[string]string{"provider": provider, "access": "full"}
		if !handler.oauth.Available(provider) {
			item["access"] = "unavailable"
			item["detail"] = "OAuth " + providerDisplayName(provider) + " не настроен"
		}
		result = append(result, item)
	}
	return append(result,
		map[string]string{"provider": "boosty", "access": "unavailable", "detail": "У Boosty пока нет публичного официального API чата"},
		map[string]string{"provider": "vk_video", "access": "unavailable", "detail": "Read-only подключение появится после регистрации VK-приложения"},
	)
}

func providerDisplayName(provider string) string {
	if provider == "youtube" {
		return "YouTube"
	}
	if provider == "twitch" {
		return "Twitch"
	}
	return "Kick"
}

func writeResult(response http.ResponseWriter, value any, err error) {
	if err == nil {
		writeJSON(response, http.StatusOK, value)
		return
	}
	var applicationError *ApplicationError
	var oauthError *OauthError
	if errors.As(err, &applicationError) || errors.As(err, &oauthError) {
		writeError(response, http.StatusBadRequest, err.Error())
		return
	}
	slog.Error("Chat request failed", "error", err)
	writeError(response, http.StatusInternalServerError, "internal server error")
}

func writeError(response http.ResponseWriter, status int, message string) {
	writeJSON(response, status, map[string]string{"error": message})
}

func writeJSON(response http.ResponseWriter, status int, value any) {
	response.Header().Set("Content-Type", "application/json")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(value)
}

var _ http.Handler = (*HTTPHandler)(nil)
var _ ChatAPI = (*Application)(nil)
var _ HTTPOauth = (*Oauth)(nil)
var _ HTTPStore = (*Store)(nil)
