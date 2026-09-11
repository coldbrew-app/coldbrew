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
	AuthorizationURL(Source, string, string) (string, error)
	Connect(context.Context, Source, int, string, string) error
	Disconnect(context.Context, Source, int) error
}

type httpDonateStreamApplication interface {
	Connect(context.Context, int, string) error
	Disconnect(context.Context, int) error
}

type HTTPHandler struct {
	application   httpApplication
	donateStream  httpDonateStreamApplication
	serviceSecret string
}

func NewHTTPHandler(application *Application, donateStream *DonateStreamApplication, serviceSecret string) *HTTPHandler {
	return newHTTPHandler(application, donateStream, serviceSecret)
}

func newHTTPHandler(application httpApplication, donateStream httpDonateStreamApplication, serviceSecret string) *HTTPHandler {
	return &HTTPHandler{application: application, donateStream: donateStream, serviceSecret: serviceSecret}
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
		Source      string `json:"source"`
		RedirectURI string `json:"redirectUri"`
		State       string `json:"state"`
	}
	if !decodeInput(response, request, &input) {
		return
	}
	source, validSource := parseSource(input.Source)
	if !validSource || source == DonateStreamSource || !validRedirectURI(input.RedirectURI) || (source == StreamlabsSource && !validOAuthState(input.State)) {
		writeError(response, http.StatusBadRequest, "invalid OAuth authorization request")
		return
	}
	authorizationURL, err := handler.application.AuthorizationURL(source, input.RedirectURI, input.State)
	if err != nil {
		slog.Error("create donation provider authorization URL", "source", source, "error", err)
		writeError(response, http.StatusInternalServerError, "internal server error")
		return
	}
	writeJSON(response, http.StatusOK, map[string]string{
		"authorizationUrl": authorizationURL,
	})
}

func (handler *HTTPHandler) authenticated(request *http.Request) bool {
	received := request.Header.Get("Authorization")
	expected := "Bearer " + handler.serviceSecret
	return len(received) == len(expected) && subtle.ConstantTimeCompare([]byte(received), []byte(expected)) == 1
}

func (handler *HTTPHandler) handleConnect(response http.ResponseWriter, request *http.Request) {
	var input struct {
		UserID      int    `json:"userId"`
		Source      string `json:"source"`
		AuthCode    string `json:"authCode"`
		RedirectURI string `json:"redirectUri"`
		WidgetURL   string `json:"widgetUrl"`
	}
	if !decodeInput(response, request, &input) || !validUserID(response, input.UserID) {
		return
	}
	source, validSource := parseSource(input.Source)
	if !validSource {
		writeError(response, http.StatusBadRequest, "invalid donation source")
		return
	}
	if source == DonateStreamSource {
		if len(input.WidgetURL) == 0 || len(input.WidgetURL) > 4096 || input.AuthCode != "" || input.RedirectURI != "" {
			writeError(response, http.StatusBadRequest, "invalid widget connection request")
			return
		}
		if err := handler.donateStream.Connect(request.Context(), input.UserID, input.WidgetURL); err != nil {
			slog.Error("donate.stream connection failed", "userId", input.UserID, "error", err)
			if donateStreamInvalidInput(err) || donateStreamUnauthorized(err) {
				writeError(response, http.StatusBadRequest, "invalid donate.stream widget URL")
				return
			}
			writeError(response, http.StatusBadGateway, "donate.stream connection failed")
			return
		}
	} else {
		if len(input.AuthCode) == 0 || len(input.AuthCode) > 4096 || input.WidgetURL != "" || !validRedirectURI(input.RedirectURI) {
			writeError(response, http.StatusBadRequest, "invalid OAuth connection request")
			return
		}
		if err := handler.application.Connect(request.Context(), source, input.UserID, input.AuthCode, input.RedirectURI); err != nil {
			slog.Error(source.displayName()+" connection failed", "userId", input.UserID, "error", err)
			writeError(response, http.StatusBadGateway, source.displayName()+" connection failed")
			return
		}
	}
	writeJSON(response, http.StatusOK, map[string]bool{"connected": true})
}

func (handler *HTTPHandler) handleDisconnect(response http.ResponseWriter, request *http.Request) {
	var input struct {
		Source string `json:"source"`
		UserID int    `json:"userId"`
	}
	if !decodeInput(response, request, &input) || !validUserID(response, input.UserID) {
		return
	}
	source, validSource := parseSource(input.Source)
	if !validSource {
		writeError(response, http.StatusBadRequest, "invalid donation source")
		return
	}
	var err error
	if source == DonateStreamSource {
		err = handler.donateStream.Disconnect(request.Context(), input.UserID)
	} else {
		err = handler.application.Disconnect(request.Context(), source, input.UserID)
	}
	if err != nil {
		slog.Error("disconnect donation source", "source", source, "userId", input.UserID, "error", err)
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

func validOAuthState(value string) bool {
	return len(value) >= 32 && len(value) <= 512
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
var _ httpDonateStreamApplication = (*DonateStreamApplication)(nil)
