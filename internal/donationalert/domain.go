package donationalert

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
)

const (
	MaxAlertAge      = 10 * time.Minute
	MaxPendingAlerts = 100
	PlayerLease      = 15 * time.Second
	StreamPollEvery  = 500 * time.Millisecond
	PreparationLease = 2 * time.Minute
	PreparationTries = 3
	// PlaybackAcknowledgementTimeout is deliberately longer than the maximum
	// renderer path (asset loading, both audio tracks, and exit animation). It
	// prevents a lost finish acknowledgement from blocking a user's queue.
	PlaybackAcknowledgementTimeout = 2 * time.Minute
	MaxEncodedRequest              = 15 << 20
	MaxAlertAuthorRunes            = 200
	MaxAlertMessageRunes           = 2000
)

var (
	ErrNotFound     = errors.New("donation alert resource not found")
	ErrInvalidToken = errors.New("invalid donation alert overlay token")
	ErrLeaseLost    = errors.New("donation alert lease lost")
	ErrConflict     = errors.New("donation alert conflict")
	colorPattern    = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
)

type inputValidationError struct{ message string }

func (err *inputValidationError) Error() string { return err.message }

func validationError(message string) error { return &inputValidationError{message: message} }

type Source string

const (
	DonationAlertsSource Source = "donationalerts"
	DonateStreamSource   Source = "donate_stream"
	StreamlabsSource     Source = "streamlabs"
)

var allSources = []Source{DonationAlertsSource, DonateStreamSource, StreamlabsSource}

func ValidSource(source Source) bool { return slices.Contains(allSources, source) }

type AssetKind string

const (
	ImageAsset AssetKind = "image"
	SoundAsset AssetKind = "sound"
	TTSAsset   AssetKind = "tts"
)

type Asset struct {
	AssetID     string    `json:"assetId"`
	Kind        AssetKind `json:"kind"`
	ContentType string    `json:"contentType"`
	SizeBytes   int       `json:"sizeBytes"`
	DurationMS  *int      `json:"durationMs"`
	CreatedAt   time.Time `json:"createdAt"`
	Content     []byte    `json:"-"`
}

type Settings struct {
	Enabled           bool     `json:"enabled"`
	Paused            bool     `json:"paused"`
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

func DefaultSettings() Settings {
	return Settings{
		EnabledSources:    slices.Clone(allSources),
		DisplayDurationMS: 7000,
		SoundVolume:       80,
		TTSVoice:          "ru",
		TTSVolume:         80,
		AccentColor:       "#f59e0b",
	}
}

func (settings Settings) Validate() error {
	if settings.DisplayDurationMS < 1000 || settings.DisplayDurationMS > 30000 {
		return validationError("display duration must be between 1000 and 30000 milliseconds")
	}
	if settings.SoundVolume < 0 || settings.SoundVolume > 100 || settings.TTSVolume < 0 || settings.TTSVolume > 100 {
		return validationError("volume must be between 0 and 100")
	}
	settings.TTSVoice = strings.TrimSpace(settings.TTSVoice)
	if len(settings.TTSVoice) < 1 || len(settings.TTSVoice) > 64 {
		return validationError("invalid TTS voice")
	}
	if settings.TTSVoice != DefaultTTSVoice {
		return validationError("unsupported TTS voice")
	}
	if !colorPattern.MatchString(settings.AccentColor) {
		return validationError("invalid accent color")
	}
	seen := make(map[Source]struct{}, len(settings.EnabledSources))
	for _, source := range settings.EnabledSources {
		if !ValidSource(source) {
			return validationError(fmt.Sprintf("invalid donation source %q", source))
		}
		if _, duplicate := seen[source]; duplicate {
			return validationError(fmt.Sprintf("duplicate donation source %q", source))
		}
		seen[source] = struct{}{}
	}
	return nil
}

type PlaybackKind string

const (
	IncomingPlayback PlaybackKind = "incoming"
	ReplayPlayback   PlaybackKind = "replay"
	TestPlayback     PlaybackKind = "test"
)

type PlaybackStatus string

const (
	PreparingStatus   PlaybackStatus = "preparing"
	PendingStatus     PlaybackStatus = "pending"
	PlayingStatus     PlaybackStatus = "playing"
	CompletedStatus   PlaybackStatus = "completed"
	SkippedStatus     PlaybackStatus = "skipped"
	ExpiredStatus     PlaybackStatus = "expired"
	InterruptedStatus PlaybackStatus = "interrupted"
)

type Playback struct {
	PlaybackID        string         `json:"playbackId"`
	DonationID        *int64         `json:"donationId"`
	Kind              PlaybackKind   `json:"kind"`
	State             PlaybackStatus `json:"state"`
	Source            *Source        `json:"source"`
	Author            *string        `json:"author"`
	Message           *string        `json:"message"`
	Amount            string         `json:"amount"`
	Currency          string         `json:"currency"`
	ImageAssetID      *string        `json:"imageAssetId"`
	SoundAssetID      *string        `json:"soundAssetId"`
	TTSAssetID        *string        `json:"ttsAssetId"`
	DisplayDurationMS int            `json:"displayDurationMs"`
	SoundVolume       int            `json:"soundVolume"`
	TTSVolume         int            `json:"ttsVolume"`
	AccentColor       string         `json:"accentColor"`
	CreatedAt         time.Time      `json:"createdAt"`
	StartedAt         *time.Time     `json:"startedAt"`
	FinishedAt        *time.Time     `json:"finishedAt"`
	Detail            *string        `json:"detail"`
}

// MarshalJSON keeps donation IDs lossless for JavaScript clients while the
// domain model and database layer continue to use an integer identifier.
func (playback Playback) MarshalJSON() ([]byte, error) {
	type playbackAlias Playback
	var donationID *string
	if playback.DonationID != nil {
		value := strconv.FormatInt(*playback.DonationID, 10)
		donationID = &value
	}
	return json.Marshal(struct {
		playbackAlias
		DonationID *string `json:"donationId"`
	}{playbackAlias: playbackAlias(playback), DonationID: donationID})
}

type DiagnosticCode string

const (
	ImageUnavailableDiagnostic   DiagnosticCode = "image_unavailable"
	SoundUnavailableDiagnostic   DiagnosticCode = "sound_unavailable"
	TTSUnavailableDiagnostic     DiagnosticCode = "tts_unavailable"
	AudioBlockedDiagnostic       DiagnosticCode = "audio_blocked"
	AlertExpiredDiagnostic       DiagnosticCode = "alert_expired"
	BacklogLimitDiagnostic       DiagnosticCode = "backlog_limit"
	PlaybackTimeoutDiagnostic    DiagnosticCode = "playback_timeout"
	PlayerDisconnectedDiagnostic DiagnosticCode = "player_disconnected"
	OverlayRotatedDiagnostic     DiagnosticCode = "overlay_rotated"
	PlaybackIssueDiagnostic      DiagnosticCode = "playback_issue"
)

func validRendererDiagnostic(code DiagnosticCode) bool {
	switch code {
	case ImageUnavailableDiagnostic, SoundUnavailableDiagnostic, TTSUnavailableDiagnostic, AudioBlockedDiagnostic:
		return true
	case AlertExpiredDiagnostic, BacklogLimitDiagnostic, PlaybackTimeoutDiagnostic, PlayerDisconnectedDiagnostic,
		OverlayRotatedDiagnostic, PlaybackIssueDiagnostic:
		return false
	default:
		return false
	}
}

type DiagnosticLevel string

const (
	DiagnosticWarning DiagnosticLevel = "warning"
	DiagnosticError   DiagnosticLevel = "error"
)

type Player struct {
	PlayerID          string    `json:"playerId"`
	Generation        int64     `json:"generation"`
	State             string    `json:"state"`
	Active            bool      `json:"active"`
	Visible           bool      `json:"visible"`
	LastHeartbeatAt   time.Time `json:"lastHeartbeatAt"`
	LeaseExpiresAt    time.Time `json:"leaseExpiresAt"`
	CurrentPlaybackID *string   `json:"currentPlaybackId"`
}

type Diagnostic struct {
	Code       DiagnosticCode  `json:"code"`
	Level      DiagnosticLevel `json:"level"`
	Detail     string          `json:"detail"`
	OccurredAt time.Time       `json:"occurredAt"`
}

type Dashboard struct {
	Settings         Settings     `json:"settings"`
	ImageAsset       *Asset       `json:"imageAsset"`
	SoundAsset       *Asset       `json:"soundAsset"`
	HasOverlayToken  bool         `json:"hasOverlayToken"`
	ConnectedSources []Source     `json:"connectedSources"`
	ActivePlayer     *Player      `json:"activePlayer"`
	PendingCount     int          `json:"pendingCount"`
	CurrentPlayback  *Playback    `json:"currentPlayback"`
	RecentPlaybacks  []Playback   `json:"recentPlaybacks"`
	Diagnostics      []Diagnostic `json:"diagnostics"`
}

type StreamEvent struct {
	Type     string    `json:"type"`
	Playback *Playback `json:"playback,omitempty"`
	Action   string    `json:"action,omitempty"`
}

type Preparation struct {
	PlaybackID string
	UserID     int
	Generation int64
	Attempts   int
	Text       string
	Voice      string
}

type FinishOutcome string

const (
	FinishCompleted   FinishOutcome = "completed"
	FinishInterrupted FinishOutcome = "interrupted"
)
