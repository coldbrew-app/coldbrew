package donations

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/streambrew-app/streambrew/internal/donatestream"
	"github.com/streambrew-app/streambrew/internal/tourniquet"
)

const httpTestSecret = "12345678901234567890123456789012"

type httpTestApplication struct {
	authorizedSource   Source
	connectedSource    Source
	connectedUser      int
	disconnectedSource Source
	disconnectedUser   int
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

func newHTTPTestHandler(application httpApplication, donateStream, tourniquet httpWidgetApplication, alertHandler http.Handler) *HTTPHandler {
	if donateStream == nil {
		donateStream = &httpTestDonateStreamApplication{}
	}
	if tourniquet == nil {
		tourniquet = &httpTestDonateStreamApplication{}
	}
	return newHTTPHandler(application, map[Source]httpWidgetApplication{
		DonateStreamSource: donateStream,
		TourniquetSource:   tourniquet,
	}, httpTestSecret, alertHandler)
}

func (application *httpTestApplication) AuthorizationURL(source Source, redirectURI, state string) (string, error) {
	application.authorizedSource = source
	return "https://provider.test/authorize?redirect_uri=" + redirectURI + "&state=" + state, nil
}

func (application *httpTestApplication) Connect(_ context.Context, source Source, userID int, _, _ string) error {
	application.connectedSource = source
	application.connectedUser = userID
	return nil
}
func (application *httpTestApplication) Disconnect(_ context.Context, source Source, userID int) error {
	application.disconnectedSource = source
	application.disconnectedUser = userID
	return nil
}

func authorizedRequest(path, body string) *http.Request {
	request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	request.Header.Set("Authorization", "Bearer "+httpTestSecret)
	return request
}

func TestHTTPHandlerRejectsInvalidSecret(t *testing.T) {
	handler := newHTTPTestHandler(&httpTestApplication{}, nil, nil, nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/internal/disconnect", strings.NewReader(`{"source":"streamlabs","userId":42}`)))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestHTTPHandlerAuthenticatesBeforeDelegatingAlerts(t *testing.T) {
	called := false
	alertHandler := http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		called = true
		response.WriteHeader(http.StatusNoContent)
	})
	handler := newHTTPTestHandler(&httpTestApplication{}, nil, nil, alertHandler)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/internal/alerts/dashboard", strings.NewReader(`{"userId":42}`)))
	if response.Code != http.StatusUnauthorized || called {
		t.Fatalf("unauthorized status=%d called=%v", response.Code, called)
	}
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, authorizedRequest("/internal/alerts/dashboard", `{"userId":42}`))
	if response.Code != http.StatusNoContent || !called {
		t.Fatalf("authorized status=%d called=%v", response.Code, called)
	}
}

func TestHTTPHandlerValidatesConnectInput(t *testing.T) {
	handler := newHTTPTestHandler(&httpTestApplication{}, nil, nil, nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, authorizedRequest("/internal/connect", `{"userId":42,"source":"donationalerts","authCode":"code","redirectUri":"javascript:alert(1)","accessToken":""}`))
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestHTTPAuthorizationURLRequiresStreamlabsState(t *testing.T) {
	handler := newHTTPTestHandler(&httpTestApplication{}, nil, nil, nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, authorizedRequest("/internal/authorization-url", `{"source":"streamlabs","redirectUri":"https://streambrew.test/callback","state":"short"}`))
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestHTTPAuthorizationURLRoutesProvider(t *testing.T) {
	application := &httpTestApplication{}
	handler := newHTTPTestHandler(application, nil, nil, nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, authorizedRequest("/internal/authorization-url", `{"source":"streamlabs","redirectUri":"https://streambrew.test/callback","state":"12345678901234567890123456789012"}`))
	if response.Code != http.StatusOK || application.authorizedSource != StreamlabsSource {
		t.Fatalf("status=%d source=%q body=%s", response.Code, application.authorizedSource, response.Body.String())
	}
}

func TestHTTPDisconnectUsesAuthenticatedOwnerAndSourceOnly(t *testing.T) {
	application := &httpTestApplication{}
	handler := newHTTPTestHandler(application, nil, nil, nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, authorizedRequest("/internal/disconnect", `{"source":"streamlabs","userId":42}`))
	if response.Code != http.StatusOK || application.disconnectedUser != 42 || application.disconnectedSource != StreamlabsSource {
		t.Fatalf("status=%d source=%q disconnectedUser=%d", response.Code, application.disconnectedSource, application.disconnectedUser)
	}

	response = httptest.NewRecorder()
	handler.ServeHTTP(response, authorizedRequest("/internal/disconnect", `{"source":"streamlabs","userId":42,"ownerId":7}`))
	if response.Code != http.StatusBadRequest || application.disconnectedUser != 42 {
		t.Fatalf("status=%d disconnectedUser=%d", response.Code, application.disconnectedUser)
	}
}

func TestHTTPConnectsAndDisconnectsDonateStream(t *testing.T) {
	donateStream := &httpTestDonateStreamApplication{}
	handler := newHTTPTestHandler(&httpTestApplication{}, donateStream, nil, nil)
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
	handler := newHTTPTestHandler(&httpTestApplication{}, donateStream, nil, nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, authorizedRequest("/internal/connect", `{"userId":42,"source":"donate_stream","authCode":"","redirectUri":"","widgetUrl":"https://donate.stream/widget-alert?uid=group%26token=1234567890abcdef"}`))
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestHTTPConnectsAndDisconnectsTourniquet(t *testing.T) {
	tourniquetApplication := &httpTestDonateStreamApplication{}
	handler := newHTTPTestHandler(&httpTestApplication{}, nil, tourniquetApplication, nil)
	response := httptest.NewRecorder()
	widgetURL := "https://tourniquet.app/widgets/alert/AbCdEf0123456789GhIjKlMn"
	handler.ServeHTTP(response, authorizedRequest("/internal/connect", `{"userId":42,"source":"tourniquet","authCode":"","redirectUri":"","widgetUrl":"`+widgetURL+`"}`))
	if response.Code != http.StatusOK || tourniquetApplication.connectedUser != 42 || tourniquetApplication.widgetURL != widgetURL {
		t.Fatalf("status=%d application=%#v", response.Code, tourniquetApplication)
	}

	response = httptest.NewRecorder()
	handler.ServeHTTP(response, authorizedRequest("/internal/disconnect", `{"userId":42,"source":"tourniquet"}`))
	if response.Code != http.StatusOK || tourniquetApplication.disconnectedUser != 42 {
		t.Fatalf("status=%d application=%#v", response.Code, tourniquetApplication)
	}
}

func TestHTTPConnectRejectsInvalidTourniquetWidgetURL(t *testing.T) {
	tourniquetApplication := &httpTestDonateStreamApplication{
		connectErr: &tourniquet.RequestError{
			InvalidInput: true,
			Operation:    "parse widget URL",
			Cause:        errors.New("invalid token"),
		},
	}
	handler := newHTTPTestHandler(&httpTestApplication{}, nil, tourniquetApplication, nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, authorizedRequest("/internal/connect", `{"userId":42,"source":"tourniquet","authCode":"","redirectUri":"","widgetUrl":"https://tourniquet.app/widgets/alert/short"}`))
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}
