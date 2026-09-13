package donationalert

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"mime"
	"slices"
	"strings"
	"time"
)

type Application struct {
	store     *Store
	processor MediaProcessor
	now       func() time.Time
}

func NewApplication(store *Store, processor MediaProcessor) *Application {
	return &Application{store: store, processor: processor, now: time.Now}
}

func (application *Application) Dashboard(ctx context.Context, userID int) (Dashboard, error) {
	return application.store.Dashboard(ctx, userID, application.now())
}

func (application *Application) UpdateSettings(ctx context.Context, userID int, settings Settings) error {
	_, err := application.store.UpdateSettings(ctx, userID, settings)
	return err
}

func (application *Application) SetPaused(ctx context.Context, userID int, paused bool) error {
	return application.store.SetPaused(ctx, userID, paused)
}

func (application *Application) RotateToken(ctx context.Context, userID int) (string, error) {
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return "", fmt.Errorf("generate overlay token: %w", err)
	}
	token := base64.RawURLEncoding.EncodeToString(tokenBytes)
	if err := application.store.SetOverlayTokenHash(ctx, userID, hashToken(token), application.now()); err != nil {
		return "", err
	}
	return token, nil
}

func (application *Application) CreateTest(ctx context.Context, userID int) error {
	_, err := application.store.CreateTest(ctx, userID, application.now())
	return err
}

func (application *Application) Replay(ctx context.Context, userID int, playbackID string) error {
	_, err := application.store.Replay(ctx, userID, playbackID, application.now())
	return err
}

func (application *Application) Skip(ctx context.Context, userID int) error {
	_, err := application.store.Skip(ctx, userID, application.now())
	return err
}

func (application *Application) UploadAsset(ctx context.Context, userID int, kind AssetKind, declaredType string, content []byte) (Asset, error) {
	declaredType, _, err := mime.ParseMediaType(declaredType)
	if err != nil {
		return Asset{}, validationError("invalid media content type")
	}
	declaredType = strings.ToLower(declaredType)
	var media Media
	switch kind {
	case ImageAsset:
		allowed := []string{"image/gif", "image/jpeg", "image/png", "image/webp"}
		if !slices.Contains(allowed, declaredType) {
			return Asset{}, &MediaError{Code: MediaUnsupported}
		}
		media, err = application.processor.PrepareImage(ctx, content)
		if err == nil && media.MIMEType != declaredType {
			return Asset{}, &MediaError{Code: MediaInvalid, Err: errors.New("image content type does not match content")}
		}
	case SoundAsset:
		allowed := []string{"audio/mpeg", "audio/ogg", "audio/opus", "audio/wav", "audio/wave", "audio/x-wav"}
		if !slices.Contains(allowed, declaredType) {
			return Asset{}, &MediaError{Code: MediaUnsupported}
		}
		media, err = application.processor.PrepareSound(ctx, content)
	case TTSAsset:
		return Asset{}, validationError("invalid asset kind")
	default:
		return Asset{}, validationError("invalid asset kind")
	}
	if err != nil {
		return Asset{}, err
	}
	return application.store.SaveAsset(ctx, userID, kind, media, application.now())
}

func (application *Application) DeleteAsset(ctx context.Context, userID int, assetID string) error {
	return application.store.DeleteAsset(ctx, userID, assetID)
}

func (application *Application) ReadAsset(ctx context.Context, assetID string, userID *int, token *string) (*Asset, error) {
	if (userID == nil) == (token == nil) {
		return nil, errors.New("exactly one asset principal is required")
	}
	ownerID := 0
	if userID != nil {
		ownerID = *userID
		if ownerID <= 0 {
			return nil, errors.New("invalid user id")
		}
	} else {
		if !validToken(*token) {
			return nil, ErrInvalidToken
		}
		var err error
		ownerID, err = application.store.UserIDByTokenHash(ctx, hashToken(*token))
		if err != nil {
			return nil, err
		}
	}
	if token != nil {
		return application.store.PlayerAssetForUser(ctx, ownerID, assetID)
	}
	return application.store.AssetForUser(ctx, ownerID, assetID)
}

func (application *Application) OpenPlayer(ctx context.Context, token string) (Player, error) {
	if !validToken(token) {
		return Player{}, ErrInvalidToken
	}
	playerID, err := randomUUID()
	if err != nil {
		return Player{}, err
	}
	_, player, err := application.store.OpenPlayer(ctx, hashToken(token), playerID, application.now())
	return player, err
}

func (application *Application) Heartbeat(ctx context.Context, token, playerID string, generation int64, active, visible bool) error {
	if !validToken(token) || generation <= 0 {
		return ErrLeaseLost
	}
	return application.store.Heartbeat(ctx, hashToken(token), playerID, generation, active, visible, application.now())
}

func (application *Application) Started(ctx context.Context, token, playerID string, generation int64, playbackID string) error {
	if !validToken(token) || generation <= 0 {
		return ErrLeaseLost
	}
	return application.store.StartPlayback(ctx, hashToken(token), playerID, generation, playbackID, application.now())
}

func (application *Application) Finished(ctx context.Context, token, playerID string, generation int64, playbackID string, outcome FinishOutcome) error {
	if !validToken(token) || generation <= 0 {
		return ErrLeaseLost
	}
	return application.store.FinishPlayback(ctx, hashToken(token), playerID, generation, playbackID, outcome, application.now())
}

func (application *Application) ReportDiagnostic(ctx context.Context, token, playerID string, generation int64, playbackID string, code DiagnosticCode) error {
	if !validToken(token) || generation <= 0 {
		return ErrLeaseLost
	}
	if !validRendererDiagnostic(code) {
		return errors.New("invalid renderer diagnostic")
	}
	return application.store.RecordPlaybackDiagnostic(ctx, hashToken(token), playerID, generation, playbackID, code, application.now())
}

func (application *Application) ClosePlayer(ctx context.Context, token, playerID string, generation int64) error {
	if !validToken(token) || generation <= 0 {
		return nil
	}
	return application.store.ReleasePlayer(ctx, hashToken(token), playerID, generation, application.now())
}

func (application *Application) Stream(ctx context.Context, token, playerID string, generation int64, emit func(StreamEvent) error) error {
	if !validToken(token) || generation <= 0 {
		return emit(StreamEvent{Type: "revoked"})
	}
	tokenHash := hashToken(token)
	paused, current, err := application.store.StreamState(ctx, tokenHash, playerID, generation, application.now())
	if errors.Is(err, ErrLeaseLost) {
		return emit(StreamEvent{Type: "revoked"})
	}
	if err != nil {
		return err
	}
	ticker := time.NewTicker(StreamPollEvery)
	defer ticker.Stop()
	polls := 0
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
		}
		polls++
		if polls%20 == 0 {
			if err := emit(StreamEvent{Type: "keepalive"}); err != nil {
				return err
			}
		}
		now := application.now()
		nextPaused, storedCurrent, err := application.store.StreamState(ctx, tokenHash, playerID, generation, now)
		if errors.Is(err, ErrLeaseLost) {
			return emit(StreamEvent{Type: "revoked"})
		}
		if err != nil {
			return err
		}
		if nextPaused != paused {
			action := "resume"
			if nextPaused {
				action = "pause"
			}
			if emitErr := emit(StreamEvent{Type: "control", Action: action}); emitErr != nil {
				return emitErr
			}
			paused = nextPaused
		}
		if current != nil && (storedCurrent == nil || storedCurrent.PlaybackID != current.PlaybackID) {
			status, statusErr := application.store.PlaybackStatus(ctx, current.PlaybackID)
			if statusErr != nil && !errors.Is(statusErr, ErrNotFound) {
				return statusErr
			}
			if status == SkippedStatus || status == InterruptedStatus || status == ExpiredStatus {
				if emitErr := emit(StreamEvent{Type: "control", Action: "skip"}); emitErr != nil {
					return emitErr
				}
			}
			current = nil
		}
		if current == nil && storedCurrent != nil {
			current = storedCurrent
		}
		if current == nil && !paused {
			current, err = application.store.ClaimPlayback(ctx, tokenHash, playerID, generation, now)
			if errors.Is(err, ErrLeaseLost) {
				return emit(StreamEvent{Type: "revoked"})
			}
			if err != nil {
				return err
			}
			if current != nil {
				if err := emit(StreamEvent{Type: "playback", Playback: current}); err != nil {
					return err
				}
			}
		}
	}
}

func validToken(token string) bool { return len(token) >= 32 && len(token) <= 100 }

func hashToken(token string) string {
	hash := sha256.Sum256([]byte(token))
	return hex.EncodeToString(hash[:])
}

func randomUUID() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", fmt.Errorf("generate player id: %w", err)
	}
	value[6] = value[6]&0x0f | 0x40
	value[8] = value[8]&0x3f | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		value[0:4], value[4:6], value[6:8], value[8:10], value[10:16]), nil
}
