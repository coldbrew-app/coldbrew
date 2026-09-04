package donations

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const httpTestSecret = "12345678901234567890123456789012"

type httpTestApplication struct {
	connectedUser    int
	disconnectedUser int
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
	handler := newHTTPHandler(&httpTestApplication{}, httpTestSecret)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/internal/disconnect", strings.NewReader(`{"userId":42}`)))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestHTTPHandlerValidatesConnectInput(t *testing.T) {
	handler := newHTTPHandler(&httpTestApplication{}, httpTestSecret)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, authorizedRequest("/internal/connect", `{"userId":42,"authCode":"code","redirectUri":"javascript:alert(1)"}`))
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestHTTPDisconnectUsesAuthenticatedOwnerOnly(t *testing.T) {
	application := &httpTestApplication{}
	handler := newHTTPHandler(application, httpTestSecret)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, authorizedRequest("/internal/disconnect", `{"userId":42}`))
	if response.Code != http.StatusOK || application.disconnectedUser != 42 {
		t.Fatalf("status=%d disconnectedUser=%d", response.Code, application.disconnectedUser)
	}

	response = httptest.NewRecorder()
	handler.ServeHTTP(response, authorizedRequest("/internal/disconnect", `{"userId":42,"ownerId":7}`))
	if response.Code != http.StatusBadRequest || application.disconnectedUser != 42 {
		t.Fatalf("status=%d disconnectedUser=%d", response.Code, application.disconnectedUser)
	}
}
