package donations

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
)

type httpApplication interface {
	AuthorizationURL(string) string
	Connect(context.Context, int, string, string) error
	Disconnect(context.Context, int) error
}

type HTTPHandler struct {
	application   httpApplication
	serviceSecret string
}

func NewHTTPHandler(application *Application, serviceSecret string) *HTTPHandler {
	return newHTTPHandler(application, serviceSecret)
}

func newHTTPHandler(application httpApplication, serviceSecret string) *HTTPHandler {
	return &HTTPHandler{application: application, serviceSecret: serviceSecret}
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
	case request.URL.Path == "/internal/authorization-url" && request.Method == http.MethodPost:
		handler.handleAuthorizationURL(response, request)
	case request.URL.Path == "/internal/connect" && request.Method == http.MethodPost:
		handler.handleConnect(response, request)
	case request.URL.Path == "/internal/disconnect" && request.Method == http.MethodPost:
		handler.handleDisconnect(response, request)
	default:
		http.NotFound(response, request)
	}
}

func (handler *HTTPHandler) handleAuthorizationURL(response http.ResponseWriter, request *http.Request) {
	var input struct {
		RedirectURI string `json:"redirectUri"`
	}
	if !decodeInput(response, request, &input) {
		return
	}
	if !validRedirectURI(input.RedirectURI) {
		writeError(response, http.StatusBadRequest, "invalid OAuth redirect URI")
		return
	}
	writeJSON(response, http.StatusOK, map[string]string{
		"authorizationUrl": handler.application.AuthorizationURL(input.RedirectURI),
	})
}

func (handler *HTTPHandler) authenticated(request *http.Request) bool {
	received := request.Header.Get("Authorization")
	expected := "Bearer " + handler.serviceSecret
	return len(received) == len(expected) && subtle.ConstantTimeCompare([]byte(received), []byte(expected)) == 1
}

type userInput struct {
	UserID int `json:"userId"`
}

func (handler *HTTPHandler) handleConnect(response http.ResponseWriter, request *http.Request) {
	var input struct {
		UserID      int    `json:"userId"`
		AuthCode    string `json:"authCode"`
		RedirectURI string `json:"redirectUri"`
	}
	if !decodeInput(response, request, &input) || !validUserID(response, input.UserID) {
		return
	}
	if len(input.AuthCode) == 0 || len(input.AuthCode) > 4096 || !validRedirectURI(input.RedirectURI) {
		writeError(response, http.StatusBadRequest, "invalid OAuth connection request")
		return
	}
	if err := handler.application.Connect(request.Context(), input.UserID, input.AuthCode, input.RedirectURI); err != nil {
		slog.Error("DonationAlerts connection failed", "userId", input.UserID, "error", err)
		writeError(response, http.StatusBadGateway, "DonationAlerts connection failed")
		return
	}
	writeJSON(response, http.StatusOK, map[string]bool{"connected": true})
}

func (handler *HTTPHandler) handleDisconnect(response http.ResponseWriter, request *http.Request) {
	var input userInput
	if !decodeInput(response, request, &input) || !validUserID(response, input.UserID) {
		return
	}
	if err := handler.application.Disconnect(request.Context(), input.UserID); err != nil {
		slog.Error("disconnect DonationAlerts", "userId", input.UserID, "error", err)
		writeError(response, http.StatusInternalServerError, "internal server error")
		return
	}
	writeJSON(response, http.StatusOK, nil)
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

func validRedirectURI(value string) bool {
	parsed, err := url.Parse(value)
	return err == nil && (parsed.Scheme == "http" || parsed.Scheme == "https") && parsed.Host != "" && !strings.Contains(value, "#")
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
var _ httpApplication = (*Application)(nil)
