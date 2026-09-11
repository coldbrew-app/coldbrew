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

type httpDonationAlertsApplication interface {
	AuthorizationURL(string) string
	Connect(context.Context, int, string, string) error
	Disconnect(context.Context, int) error
}

type httpDonateStreamApplication interface {
	Connect(context.Context, int, string) error
	Disconnect(context.Context, int) error
}

type HTTPHandler struct {
	donationAlerts httpDonationAlertsApplication
	donateStream   httpDonateStreamApplication
	serviceSecret  string
}

func NewHTTPHandler(donationAlerts *Application, donateStream *DonateStreamApplication, serviceSecret string) *HTTPHandler {
	return newHTTPHandler(donationAlerts, donateStream, serviceSecret)
}

func newHTTPHandler(donationAlerts httpDonationAlertsApplication, donateStream httpDonateStreamApplication, serviceSecret string) *HTTPHandler {
	return &HTTPHandler{donationAlerts: donationAlerts, donateStream: donateStream, serviceSecret: serviceSecret}
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
		"authorizationUrl": handler.donationAlerts.AuthorizationURL(input.RedirectURI),
	})
}

func (handler *HTTPHandler) authenticated(request *http.Request) bool {
	received := request.Header.Get("Authorization")
	expected := "Bearer " + handler.serviceSecret
	return len(received) == len(expected) && subtle.ConstantTimeCompare([]byte(received), []byte(expected)) == 1
}

type userInput struct {
	UserID int    `json:"userId"`
	Source string `json:"source"`
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
	switch input.Source {
	case "donationalerts":
		if len(input.AuthCode) == 0 || len(input.AuthCode) > 4096 || input.WidgetURL != "" || !validRedirectURI(input.RedirectURI) {
			writeError(response, http.StatusBadRequest, "invalid OAuth connection request")
			return
		}
		if err := handler.donationAlerts.Connect(request.Context(), input.UserID, input.AuthCode, input.RedirectURI); err != nil {
			slog.Error("DonationAlerts connection failed", "userId", input.UserID, "error", err)
			writeError(response, http.StatusBadGateway, "DonationAlerts connection failed")
			return
		}
	case "donate_stream":
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
	default:
		writeError(response, http.StatusBadRequest, "invalid donation source")
		return
	}
	writeJSON(response, http.StatusOK, map[string]bool{"connected": true})
}

func (handler *HTTPHandler) handleDisconnect(response http.ResponseWriter, request *http.Request) {
	var input userInput
	if !decodeInput(response, request, &input) || !validUserID(response, input.UserID) {
		return
	}
	var err error
	switch input.Source {
	case "donationalerts":
		err = handler.donationAlerts.Disconnect(request.Context(), input.UserID)
	case "donate_stream":
		err = handler.donateStream.Disconnect(request.Context(), input.UserID)
	default:
		writeError(response, http.StatusBadRequest, "invalid donation source")
		return
	}
	if err != nil {
		slog.Error("disconnect donation source", "source", input.Source, "userId", input.UserID, "error", err)
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
var _ httpDonationAlertsApplication = (*Application)(nil)
var _ httpDonateStreamApplication = (*DonateStreamApplication)(nil)
