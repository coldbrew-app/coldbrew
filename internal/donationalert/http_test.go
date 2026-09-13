package donationalert

import (
	"context"
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type alertHTTPTestApplication struct {
	httpApplication
	uploadCalled   bool
	closed         bool
	diagnosticCode DiagnosticCode
}

type blockingUploadApplication struct {
	alertHTTPTestApplication
	started chan struct{}
	release chan struct{}
}

type failingSettingsApplication struct {
	alertHTTPTestApplication
	err error
}

func (application *failingSettingsApplication) UpdateSettings(context.Context, int, Settings) error {
	return application.err
}

func (application *blockingUploadApplication) UploadAsset(ctx context.Context, _ int, _ AssetKind, _ string, _ []byte) (Asset, error) {
	close(application.started)
	select {
	case <-application.release:
		return Asset{}, nil
	case <-ctx.Done():
		return Asset{}, ctx.Err()
	}
}

func (application *alertHTTPTestApplication) UploadAsset(context.Context, int, AssetKind, string, []byte) (Asset, error) {
	application.uploadCalled = true
	return Asset{}, nil
}

func (*alertHTTPTestApplication) Stream(_ context.Context, _, _ string, _ int64, emit func(StreamEvent) error) error {
	return emit(StreamEvent{Type: "revoked"})
}

func (application *alertHTTPTestApplication) ClosePlayer(context.Context, string, string, int64) error {
	application.closed = true
	return nil
}

func (application *alertHTTPTestApplication) ReportDiagnostic(_ context.Context, _, _ string, _ int64, _ string, code DiagnosticCode) error {
	application.diagnosticCode = code
	return nil
}

func TestUploadRejectsDecodedSizeBeforeProcessing(t *testing.T) {
	application := &alertHTTPTestApplication{}
	handler := &HTTPHandler{application: application}
	content := strings.Repeat("A", base64.StdEncoding.EncodedLen(MaxAlertImageBytes+1))
	body := `{"userId":42,"kind":"image","contentType":"image/png","contentBase64":"` + content + `"}`
	request := httptest.NewRequest(http.MethodPost, "/internal/alerts/asset", strings.NewReader(body))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusRequestEntityTooLarge || application.uploadCalled {
		t.Fatalf("status=%d uploadCalled=%v body=%s", response.Code, application.uploadCalled, response.Body.String())
	}
}

func TestStreamClosesPlayerAfterWriterEnds(t *testing.T) {
	application := &alertHTTPTestApplication{}
	handler := &HTTPHandler{application: application}
	body := `{"token":"12345678901234567890123456789012","playerId":"c2723d6f-6d80-4abd-8456-b66bfc593a12","generation":1}`
	request := httptest.NewRequest(http.MethodPost, "/internal/alerts/overlay/stream", strings.NewReader(body))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK || !application.closed {
		t.Fatalf("status=%d closed=%v", response.Code, application.closed)
	}
	if !strings.Contains(response.Body.String(), `"type":"revoked"`) {
		t.Fatalf("stream body = %q", response.Body.String())
	}
}

type repeatedByteReader struct {
	remaining int64
	value     byte
}

func (reader *repeatedByteReader) Read(buffer []byte) (int, error) {
	if reader.remaining == 0 {
		return 0, io.EOF
	}
	count := int64(len(buffer))
	if count > reader.remaining {
		count = reader.remaining
	}
	for index := range buffer[:count] {
		buffer[index] = reader.value
	}
	reader.remaining -= count
	return int(count), nil
}

func TestUploadRejectsBodyOverTransportLimit(t *testing.T) {
	application := &alertHTTPTestApplication{}
	handler := &HTTPHandler{application: application}
	body := io.MultiReader(strings.NewReader("{}"), &repeatedByteReader{remaining: MaxEncodedRequest + 1, value: ' '})
	request := httptest.NewRequest(http.MethodPost, "/internal/alerts/asset", body)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusRequestEntityTooLarge || application.uploadCalled {
		t.Fatalf("status=%d uploadCalled=%v body=%s", response.Code, application.uploadCalled, response.Body.String())
	}
}

func TestUploadAdmissionRejectsConcurrentBodiesBeforeDecoding(t *testing.T) {
	application := &blockingUploadApplication{
		started: make(chan struct{}),
		release: make(chan struct{}),
	}
	handler := &HTTPHandler{application: application}
	body := `{"userId":42,"kind":"image","contentType":"image/png","contentBase64":"cG5n"}`

	firstResponse := httptest.NewRecorder()
	firstDone := make(chan struct{})
	go func() {
		defer close(firstDone)
		handler.ServeHTTP(
			firstResponse,
			httptest.NewRequest(http.MethodPost, "/internal/alerts/asset", strings.NewReader(body)),
		)
	}()

	select {
	case <-application.started:
	case <-time.After(time.Second):
		t.Fatal("first upload did not reach the application")
	}

	secondResponse := httptest.NewRecorder()
	handler.ServeHTTP(
		secondResponse,
		httptest.NewRequest(http.MethodPost, "/internal/alerts/asset", strings.NewReader(body)),
	)
	if secondResponse.Code != http.StatusTooManyRequests || secondResponse.Header().Get("Retry-After") != uploadRetryAfterSeconds {
		t.Fatalf("second status=%d retry-after=%q body=%s", secondResponse.Code, secondResponse.Header().Get("Retry-After"), secondResponse.Body.String())
	}

	close(application.release)
	select {
	case <-firstDone:
	case <-time.After(time.Second):
		t.Fatal("first upload did not finish")
	}
	if firstResponse.Code != http.StatusOK {
		t.Fatalf("first status=%d body=%s", firstResponse.Code, firstResponse.Body.String())
	}
}

func TestSettingsFailureDoesNotExposeInternalError(t *testing.T) {
	application := &failingSettingsApplication{err: errors.New("private postgres constraint detail")}
	handler := &HTTPHandler{application: application}
	body := `{"userId":42,"enabled":true,"enabledSources":["donationalerts"],"displayDurationMs":7000,"soundVolume":80,"ttsEnabled":false,"ttsVoice":"ru","ttsVolume":80,"accentColor":"#f59e0b","imageAssetId":null,"soundAssetId":null}`
	request := httptest.NewRequest(http.MethodPost, "/internal/alerts/settings", strings.NewReader(body))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusInternalServerError || strings.Contains(response.Body.String(), "postgres") || !strings.Contains(response.Body.String(), "internal server error") {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestSettingsValidationErrorUsesSafeMessage(t *testing.T) {
	application := &failingSettingsApplication{err: validationError("invalid accent color")}
	handler := &HTTPHandler{application: application}
	body := `{"userId":42,"enabled":true,"enabledSources":["donationalerts"],"displayDurationMs":7000,"soundVolume":80,"ttsEnabled":false,"ttsVoice":"ru","ttsVolume":80,"accentColor":"#f59e0b","imageAssetId":null,"soundAssetId":null}`
	request := httptest.NewRequest(http.MethodPost, "/internal/alerts/settings", strings.NewReader(body))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "invalid accent color") {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestRendererDiagnosticAcceptsOnlySafeCodes(t *testing.T) {
	application := &alertHTTPTestApplication{}
	handler := &HTTPHandler{application: application}
	const prefix = `{"token":"12345678901234567890123456789012","playerId":"c2723d6f-6d80-4abd-8456-b66bfc593a12","generation":1,"playbackId":"f263a56a-1b02-48b5-982a-08a4e84f9887","code":"`

	request := httptest.NewRequest(http.MethodPost, "/internal/alerts/overlay/diagnostic", strings.NewReader(prefix+`private detail"}`))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest || application.diagnosticCode != "" {
		t.Fatalf("unsafe diagnostic status=%d code=%q", response.Code, application.diagnosticCode)
	}

	request = httptest.NewRequest(http.MethodPost, "/internal/alerts/overlay/diagnostic", strings.NewReader(prefix+`audio_blocked"}`))
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK || application.diagnosticCode != AudioBlockedDiagnostic {
		t.Fatalf("safe diagnostic status=%d code=%q", response.Code, application.diagnosticCode)
	}
}
