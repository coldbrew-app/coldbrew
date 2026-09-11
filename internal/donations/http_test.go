package donations

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/lebedev-nikita/coldbrew/internal/donatestream"
)

const httpTestSecret = "12345678901234567890123456789012"

type httpTestApplication struct {
	connectedUser    int
	disconnectedUser int
}

type httpTestDonateStreamApplication struct {
	connectedUser    int
	disconnectedUser int
	widgetURL        string
	connectErr       error
}

func (application *httpTestDonateStreamApplication) Connect(_ context.Context, userID int, widgetURL string) error {
	application.connectedUser = userID
	application.widgetURL = widgetURL
	return application.connectErr
}

func (application *httpTestDonateStreamApplication) Disconnect(_ context.Context, userID int) error {
	application.disconnectedUser = userID
	return nil
}

func (*httpTestApplication) AuthorizationURL(redirectURI string) string {
	return "https://donationalerts.test/authorize?redirect_uri=" + redirectURI
}

func (application *httpTestApplication) Connect(_ context.Context, userID int, _, _ string) error {
	application.connectedUser = userID
	return nil
}
func (application *httpTestApplication) Disconnect(_ context.Context, userID int) error {
	application.disconnectedUser = userID
	return nil
}

func authorizedRequest(path, body string) *http.Request {
	request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	request.Header.Set("Authorization", "Bearer "+httpTestSecret)
	return request
}

func TestHTTPHandlerRejectsInvalidSecret(t *testing.T) {
	handler := newHTTPHandler(&httpTestApplication{}, &httpTestDonateStreamApplication{}, httpTestSecret)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/internal/disconnect", strings.NewReader(`{"userId":42}`)))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestHTTPHandlerValidatesConnectInput(t *testing.T) {
	handler := newHTTPHandler(&httpTestApplication{}, &httpTestDonateStreamApplication{}, httpTestSecret)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, authorizedRequest("/internal/connect", `{"userId":42,"source":"donationalerts","authCode":"code","redirectUri":"javascript:alert(1)","accessToken":""}`))
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestHTTPDisconnectUsesAuthenticatedOwnerOnly(t *testing.T) {
	application := &httpTestApplication{}
	donateStream := &httpTestDonateStreamApplication{}
	handler := newHTTPHandler(application, donateStream, httpTestSecret)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, authorizedRequest("/internal/disconnect", `{"userId":42,"source":"donationalerts"}`))
	if response.Code != http.StatusOK || application.disconnectedUser != 42 {
		t.Fatalf("status=%d disconnectedUser=%d", response.Code, application.disconnectedUser)
	}

	response = httptest.NewRecorder()
	handler.ServeHTTP(response, authorizedRequest("/internal/disconnect", `{"userId":42,"source":"donationalerts","ownerId":7}`))
	if response.Code != http.StatusBadRequest || application.disconnectedUser != 42 {
		t.Fatalf("status=%d disconnectedUser=%d", response.Code, application.disconnectedUser)
	}
}

func TestHTTPConnectsAndDisconnectsDonateStream(t *testing.T) {
	donateStream := &httpTestDonateStreamApplication{}
	handler := newHTTPHandler(&httpTestApplication{}, donateStream, httpTestSecret)
	response := httptest.NewRecorder()
	widgetURL := "https://donate.stream/widget-alert?uid=group&token=1234567890abcdef"
	handler.ServeHTTP(response, authorizedRequest("/internal/connect", `{"userId":42,"source":"donate_stream","authCode":"","redirectUri":"","widgetUrl":"`+widgetURL+`"}`))
	if response.Code != http.StatusOK || donateStream.connectedUser != 42 || donateStream.widgetURL != widgetURL {
		t.Fatalf("status=%d application=%#v", response.Code, donateStream)
	}

	response = httptest.NewRecorder()
	handler.ServeHTTP(response, authorizedRequest("/internal/disconnect", `{"userId":42,"source":"donate_stream"}`))
	if response.Code != http.StatusOK || donateStream.disconnectedUser != 42 {
		t.Fatalf("status=%d application=%#v", response.Code, donateStream)
	}
}

func TestHTTPConnectRejectsInvalidDonateStreamWidgetURL(t *testing.T) {
	donateStream := &httpTestDonateStreamApplication{
		connectErr: &donatestream.RequestError{
			Unauthorized: true,
			Operation:    "authenticate widget",
			Cause:        errors.New("invalid token"),
		},
	}
	handler := newHTTPHandler(&httpTestApplication{}, donateStream, httpTestSecret)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, authorizedRequest("/internal/connect", `{"userId":42,"source":"donate_stream","authCode":"","redirectUri":"","widgetUrl":"https://donate.stream/widget-alert?uid=group%26token=1234567890abcdef"}`))
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}
