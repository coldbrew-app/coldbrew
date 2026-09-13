package donationalert

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"time"
)

const (
	maxJSONRequest          = 1 << 20
	maxConcurrentUploads    = 1
	uploadRetryAfterSeconds = "2"
)

var uploadSlots = make(chan struct{}, maxConcurrentUploads)

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`)

type httpApplication interface {
	Dashboard(context.Context, int) (Dashboard, error)
	UpdateSettings(context.Context, int, Settings) error
	SetPaused(context.Context, int, bool) error
	RotateToken(context.Context, int) (string, error)
	CreateTest(context.Context, int) error
	Replay(context.Context, int, string) error
	Skip(context.Context, int) error
	UploadAsset(context.Context, int, AssetKind, string, []byte) (Asset, error)
	DeleteAsset(context.Context, int, string) error
	ReadAsset(context.Context, string, *int, *string) (*Asset, error)
	OpenPlayer(context.Context, string) (Player, error)
	Heartbeat(context.Context, string, string, int64, bool, bool) error
	Started(context.Context, string, string, int64, string) error
	Finished(context.Context, string, string, int64, string, FinishOutcome) error
	ReportDiagnostic(context.Context, string, string, int64, string, DiagnosticCode) error
	ClosePlayer(context.Context, string, string, int64) error
	Stream(context.Context, string, string, int64, func(StreamEvent) error) error
}

type HTTPHandler struct{ application httpApplication }

func NewHTTPHandler(application *Application) *HTTPHandler {
	return &HTTPHandler{application: application}
}

func (handler *HTTPHandler) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		http.NotFound(response, request)
		return
	}
	switch request.URL.Path {
	case "/internal/alerts/dashboard":
		handler.dashboard(response, request)
	case "/internal/alerts/settings":
		handler.updateSettings(response, request)
	case "/internal/alerts/token/rotate":
		handler.rotateToken(response, request)
	case "/internal/alerts/test":
		handler.test(response, request)
	case "/internal/alerts/paused":
		handler.paused(response, request)
	case "/internal/alerts/skip":
		handler.skip(response, request)
	case "/internal/alerts/replay":
		handler.replay(response, request)
	case "/internal/alerts/asset":
		handler.uploadAsset(response, request)
	case "/internal/alerts/asset/delete":
		handler.deleteAsset(response, request)
	case "/internal/alerts/asset/read":
		handler.readAsset(response, request)
	case "/internal/alerts/overlay/open":
		handler.open(response, request)
	case "/internal/alerts/overlay/heartbeat":
		handler.heartbeat(response, request)
	case "/internal/alerts/overlay/started":
		handler.started(response, request)
	case "/internal/alerts/overlay/finished":
		handler.finished(response, request)
	case "/internal/alerts/overlay/diagnostic":
		handler.diagnostic(response, request)
	case "/internal/alerts/overlay/stream":
		handler.stream(response, request)
	default:
		http.NotFound(response, request)
	}
}

func (handler *HTTPHandler) dashboard(response http.ResponseWriter, request *http.Request) {
	input, ok := decodeUserID(response, request)
	if !ok {
		return
	}
	dashboard, err := handler.application.Dashboard(request.Context(), input.UserID)
	if err != nil {
		handleError(response, "load donation alert dashboard", err)
		return
	}
	writeJSON(response, http.StatusOK, dashboard)
}

func (handler *HTTPHandler) updateSettings(response http.ResponseWriter, request *http.Request) {
	var input struct {
		UserID            int      `json:"userId"`
		Enabled           bool     `json:"enabled"`
		EnabledSources    []Source `json:"enabledSources"`
		DisplayDurationMS int      `json:"displayDurationMs"`
		SoundVolume       int      `json:"soundVolume"`
		TTSEnabled        bool     `json:"ttsEnabled"`
		TTSVoice          string   `json:"ttsVoice"`
		TTSVolume         int      `json:"ttsVolume"`
		AccentColor       string   `json:"accentColor"`
		ImageAssetID      *string  `json:"imageAssetId"`
		SoundAssetID      *string  `json:"soundAssetId"`
	}
	if !decodeJSON(response, request, maxJSONRequest, &input) || !validUserID(response, input.UserID) {
		return
	}
	if (input.ImageAssetID != nil && !uuidPattern.MatchString(*input.ImageAssetID)) ||
		(input.SoundAssetID != nil && !uuidPattern.MatchString(*input.SoundAssetID)) {
		writeError(response, http.StatusBadRequest, "invalid asset id")
		return
	}
	settings := Settings{
		Enabled: input.Enabled, EnabledSources: input.EnabledSources,
		DisplayDurationMS: input.DisplayDurationMS, SoundVolume: input.SoundVolume,
		TTSEnabled: input.TTSEnabled, TTSVoice: input.TTSVoice, TTSVolume: input.TTSVolume,
		AccentColor: input.AccentColor, ImageAssetID: input.ImageAssetID, SoundAssetID: input.SoundAssetID,
	}
	if err := handler.application.UpdateSettings(request.Context(), input.UserID, settings); err != nil {
		handleError(response, "update donation alert settings", err)
		return
	}
	writeJSON(response, http.StatusOK, nil)
}

func (handler *HTTPHandler) rotateToken(response http.ResponseWriter, request *http.Request) {
	input, ok := decodeUserID(response, request)
	if !ok {
		return
	}
	token, err := handler.application.RotateToken(request.Context(), input.UserID)
	if err != nil {
		handleError(response, "rotate donation alert overlay token", err)
		return
	}
	writeJSON(response, http.StatusOK, map[string]string{"token": token})
}

func (handler *HTTPHandler) test(response http.ResponseWriter, request *http.Request) {
	input, ok := decodeUserID(response, request)
	if !ok {
		return
	}
	if err := handler.application.CreateTest(request.Context(), input.UserID); err != nil {
		handleError(response, "create donation alert test", err)
		return
	}
	writeJSON(response, http.StatusOK, nil)
}

func (handler *HTTPHandler) paused(response http.ResponseWriter, request *http.Request) {
	var input struct {
		UserID int  `json:"userId"`
		Paused bool `json:"paused"`
	}
	if !decodeJSON(response, request, maxJSONRequest, &input) || !validUserID(response, input.UserID) {
		return
	}
	if err := handler.application.SetPaused(request.Context(), input.UserID, input.Paused); err != nil {
		handleError(response, "pause donation alerts", err)
		return
	}
	writeJSON(response, http.StatusOK, nil)
}

func (handler *HTTPHandler) skip(response http.ResponseWriter, request *http.Request) {
	input, ok := decodeUserID(response, request)
	if !ok {
		return
	}
	if err := handler.application.Skip(request.Context(), input.UserID); err != nil {
		handleError(response, "skip donation alert", err)
		return
	}
	writeJSON(response, http.StatusOK, nil)
}

func (handler *HTTPHandler) replay(response http.ResponseWriter, request *http.Request) {
	var input struct {
		UserID     int    `json:"userId"`
		PlaybackID string `json:"playbackId"`
	}
	if !decodeJSON(response, request, maxJSONRequest, &input) || !validUserID(response, input.UserID) || !validUUID(response, input.PlaybackID) {
		return
	}
	if err := handler.application.Replay(request.Context(), input.UserID, input.PlaybackID); err != nil {
		handleError(response, "replay donation alert", err)
		return
	}
	writeJSON(response, http.StatusOK, nil)
}

func (handler *HTTPHandler) uploadAsset(response http.ResponseWriter, request *http.Request) {
	select {
	case uploadSlots <- struct{}{}:
		defer func() { <-uploadSlots }()
	default:
		response.Header().Set("Retry-After", uploadRetryAfterSeconds)
		writeError(response, http.StatusTooManyRequests, "another upload is already being processed")
		return
	}

	var input struct {
		UserID        int       `json:"userId"`
		Kind          AssetKind `json:"kind"`
		ContentType   string    `json:"contentType"`
		ContentBase64 string    `json:"contentBase64"`
	}
	if !decodeJSON(response, request, MaxEncodedRequest, &input) || !validUserID(response, input.UserID) {
		return
	}
	maxDecoded := MaxAlertImageBytes
	if input.Kind == SoundAsset {
		maxDecoded = MaxAlertSoundBytes
	} else if input.Kind != ImageAsset {
		writeError(response, http.StatusBadRequest, "invalid asset kind")
		return
	}
	decodedLength := decodedBase64Length(input.ContentBase64)
	if decodedLength <= 0 {
		writeError(response, http.StatusBadRequest, "invalid base64 content")
		return
	}
	if decodedLength > maxDecoded {
		writeError(response, http.StatusRequestEntityTooLarge, "upload too large")
		return
	}
	content, err := base64.StdEncoding.Strict().DecodeString(input.ContentBase64)
	if err != nil {
		writeError(response, http.StatusBadRequest, "invalid base64 content")
		return
	}
	if len(content) == 0 {
		writeError(response, http.StatusBadRequest, "invalid base64 content")
		return
	}
	if len(content) > maxDecoded {
		writeError(response, http.StatusRequestEntityTooLarge, "upload too large")
		return
	}
	asset, err := handler.application.UploadAsset(request.Context(), input.UserID, input.Kind, input.ContentType, content)
	if err != nil {
		handleError(response, "upload donation alert asset", err)
		return
	}
	writeJSON(response, http.StatusOK, asset)
}

func decodedBase64Length(value string) int {
	if len(value) == 0 || len(value)%4 != 0 {
		return -1
	}
	length := len(value) / 4 * 3
	if value[len(value)-1] == '=' {
		length--
	}
	if value[len(value)-2] == '=' {
		length--
	}
	return length
}

func (handler *HTTPHandler) deleteAsset(response http.ResponseWriter, request *http.Request) {
	var input struct {
		UserID  int    `json:"userId"`
		AssetID string `json:"assetId"`
	}
	if !decodeJSON(response, request, maxJSONRequest, &input) || !validUserID(response, input.UserID) || !validUUID(response, input.AssetID) {
		return
	}
	if err := handler.application.DeleteAsset(request.Context(), input.UserID, input.AssetID); err != nil {
		handleError(response, "delete donation alert asset", err)
		return
	}
	writeJSON(response, http.StatusOK, nil)
}

func (handler *HTTPHandler) readAsset(response http.ResponseWriter, request *http.Request) {
	var input struct {
		AssetID string  `json:"assetId"`
		UserID  *int    `json:"userId"`
		Token   *string `json:"token"`
	}
	if !decodeJSON(response, request, maxJSONRequest, &input) || !validUUID(response, input.AssetID) {
		return
	}
	if (input.UserID == nil) == (input.Token == nil) || (input.UserID != nil && *input.UserID <= 0) || (input.Token != nil && !validToken(*input.Token)) {
		writeError(response, http.StatusBadRequest, "invalid asset principal")
		return
	}
	asset, err := handler.application.ReadAsset(request.Context(), input.AssetID, input.UserID, input.Token)
	if err != nil {
		handleError(response, "read donation alert asset", err)
		return
	}
	response.Header().Set("Content-Type", asset.ContentType)
	response.Header().Set("Cache-Control", "private, max-age=3600")
	response.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(response, request, "", asset.CreatedAt, bytes.NewReader(asset.Content))
}

func (handler *HTTPHandler) open(response http.ResponseWriter, request *http.Request) {
	var input struct {
		Token string `json:"token"`
	}
	if !decodeJSON(response, request, maxJSONRequest, &input) {
		return
	}
	player, err := handler.application.OpenPlayer(request.Context(), input.Token)
	if err != nil {
		handleError(response, "open donation alert overlay", err)
		return
	}
	writeJSON(response, http.StatusOK, player)
}

func (handler *HTTPHandler) heartbeat(response http.ResponseWriter, request *http.Request) {
	var input struct {
		Token      string `json:"token"`
		PlayerID   string `json:"playerId"`
		Generation int64  `json:"generation"`
		Active     bool   `json:"active"`
		Visible    bool   `json:"visible"`
	}
	if !decodeJSON(response, request, maxJSONRequest, &input) || !validPlayer(response, input.Token, input.PlayerID, input.Generation) {
		return
	}
	if err := handler.application.Heartbeat(request.Context(), input.Token, input.PlayerID, input.Generation, input.Active, input.Visible); err != nil {
		handleError(response, "heartbeat donation alert overlay", err)
		return
	}
	writeJSON(response, http.StatusOK, nil)
}

func (handler *HTTPHandler) started(response http.ResponseWriter, request *http.Request) {
	var input struct {
		Token      string `json:"token"`
		PlayerID   string `json:"playerId"`
		Generation int64  `json:"generation"`
		PlaybackID string `json:"playbackId"`
	}
	if !decodeJSON(response, request, maxJSONRequest, &input) || !validPlayer(response, input.Token, input.PlayerID, input.Generation) || !validUUID(response, input.PlaybackID) {
		return
	}
	if err := handler.application.Started(request.Context(), input.Token, input.PlayerID, input.Generation, input.PlaybackID); err != nil {
		handleError(response, "start donation alert playback", err)
		return
	}
	writeJSON(response, http.StatusOK, nil)
}

func (handler *HTTPHandler) finished(response http.ResponseWriter, request *http.Request) {
	var input struct {
		Token      string        `json:"token"`
		PlayerID   string        `json:"playerId"`
		Generation int64         `json:"generation"`
		PlaybackID string        `json:"playbackId"`
		Outcome    FinishOutcome `json:"outcome"`
	}
	if !decodeJSON(response, request, maxJSONRequest, &input) || !validPlayer(response, input.Token, input.PlayerID, input.Generation) || !validUUID(response, input.PlaybackID) {
		return
	}
	if input.Outcome != FinishCompleted && input.Outcome != FinishInterrupted {
		writeError(response, http.StatusBadRequest, "invalid playback outcome")
		return
	}
	if err := handler.application.Finished(request.Context(), input.Token, input.PlayerID, input.Generation, input.PlaybackID, input.Outcome); err != nil {
		handleError(response, "finish donation alert playback", err)
		return
	}
	writeJSON(response, http.StatusOK, nil)
}

func (handler *HTTPHandler) diagnostic(response http.ResponseWriter, request *http.Request) {
	var input struct {
		Token      string         `json:"token"`
		PlayerID   string         `json:"playerId"`
		Generation int64          `json:"generation"`
		PlaybackID string         `json:"playbackId"`
		Code       DiagnosticCode `json:"code"`
	}
	if !decodeJSON(response, request, maxJSONRequest, &input) || !validPlayer(response, input.Token, input.PlayerID, input.Generation) || !validUUID(response, input.PlaybackID) {
		return
	}
	if !validRendererDiagnostic(input.Code) {
		writeError(response, http.StatusBadRequest, "invalid renderer diagnostic")
		return
	}
	if err := handler.application.ReportDiagnostic(request.Context(), input.Token, input.PlayerID, input.Generation, input.PlaybackID, input.Code); err != nil {
		handleError(response, "record donation alert renderer diagnostic", err)
		return
	}
	writeJSON(response, http.StatusOK, nil)
}

func (handler *HTTPHandler) stream(response http.ResponseWriter, request *http.Request) {
	var input struct {
		Token      string `json:"token"`
		PlayerID   string `json:"playerId"`
		Generation int64  `json:"generation"`
	}
	if !decodeJSON(response, request, maxJSONRequest, &input) || !validPlayer(response, input.Token, input.PlayerID, input.Generation) {
		return
	}
	defer func(requestContext context.Context) {
		closeContext, cancel := context.WithTimeout(context.WithoutCancel(requestContext), 2*time.Second)
		defer cancel()
		if err := handler.application.ClosePlayer(closeContext, input.Token, input.PlayerID, input.Generation); err != nil {
			slog.Error("Close donation alert player", "playerId", input.PlayerID, "error", err)
		}
	}(request.Context())
	flusher, ok := response.(http.Flusher)
	if !ok {
		writeError(response, http.StatusInternalServerError, "streaming unavailable")
		return
	}
	response.Header().Set("Content-Type", "application/x-ndjson; charset=utf-8")
	response.Header().Set("Cache-Control", "no-cache, no-store")
	response.Header().Set("X-Accel-Buffering", "no")
	response.WriteHeader(http.StatusOK)
	flusher.Flush()
	encoder := json.NewEncoder(response)
	err := handler.application.Stream(request.Context(), input.Token, input.PlayerID, input.Generation, func(event StreamEvent) error {
		if err := encoder.Encode(event); err != nil {
			return err
		}
		flusher.Flush()
		return nil
	})
	if err != nil && request.Context().Err() == nil {
		slog.Error("Stream donation alerts", "playerId", input.PlayerID, "error", err)
	}
}

type userIDInput struct {
	UserID int `json:"userId"`
}

func decodeUserID(response http.ResponseWriter, request *http.Request) (userIDInput, bool) {
	var input userIDInput
	ok := decodeJSON(response, request, maxJSONRequest, &input) && validUserID(response, input.UserID)
	return input, ok
}

func decodeJSON(response http.ResponseWriter, request *http.Request, maxBytes int64, value any) bool {
	decoder := json.NewDecoder(http.MaxBytesReader(response, request.Body, maxBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		var maxError *http.MaxBytesError
		if errors.As(err, &maxError) {
			writeError(response, http.StatusRequestEntityTooLarge, "request too large")
		} else {
			writeError(response, http.StatusBadRequest, "invalid request")
		}
		return false
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		var maxError *http.MaxBytesError
		if errors.As(err, &maxError) {
			writeError(response, http.StatusRequestEntityTooLarge, "request too large")
		} else {
			writeError(response, http.StatusBadRequest, "invalid request")
		}
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

func validUUID(response http.ResponseWriter, value string) bool {
	if !uuidPattern.MatchString(value) {
		writeError(response, http.StatusBadRequest, "invalid id")
		return false
	}
	return true
}

func validPlayer(response http.ResponseWriter, token, playerID string, generation int64) bool {
	if !validToken(token) || generation <= 0 || !uuidPattern.MatchString(playerID) {
		writeError(response, http.StatusBadRequest, "invalid player identity")
		return false
	}
	return true
}

func handleError(response http.ResponseWriter, operation string, err error) {
	status := http.StatusInternalServerError
	message := "internal server error"
	switch {
	case errors.Is(err, ErrNotFound), errors.Is(err, ErrInvalidToken):
		status, message = http.StatusNotFound, "not found"
	case errors.Is(err, ErrLeaseLost), errors.Is(err, ErrConflict):
		status, message = http.StatusConflict, "alert state changed"
	default:
		var validationError *inputValidationError
		var mediaError *MediaError
		if errors.As(err, &validationError) {
			status, message = http.StatusBadRequest, validationError.Error()
		} else if errors.As(err, &mediaError) {
			switch mediaError.Code {
			case MediaTooLarge:
				status, message = http.StatusRequestEntityTooLarge, "upload too large"
			case MediaUnsupported:
				status, message = http.StatusUnsupportedMediaType, "unsupported media"
			case MediaInvalid, MediaDimensions, MediaDuration, MediaContainsVideo:
				status, message = http.StatusUnprocessableEntity, "invalid media"
			case MediaToolUnavailable, MediaProcessingFailed, MediaProcessingTimedOut:
				status, message = http.StatusServiceUnavailable, "media processing unavailable"
			default:
				status, message = http.StatusServiceUnavailable, "media processing unavailable"
			}
		}
	}
	if status >= 500 {
		slog.Error(operation, "error", err)
	}
	writeError(response, status, message)
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
