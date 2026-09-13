package donationalert

import (
	"encoding/json"
	"testing"
	"time"
)

func TestDefaultSettingsAreValid(t *testing.T) {
	settings := DefaultSettings()
	if err := settings.Validate(); err != nil {
		t.Fatalf("default settings are invalid: %v", err)
	}
}

func TestSettingsRejectUnsupportedVoiceAndDuplicateSources(t *testing.T) {
	settings := DefaultSettings()
	settings.TTSVoice = "en"
	if err := settings.Validate(); err == nil {
		t.Fatal("unsupported voice was accepted")
	}

	settings = DefaultSettings()
	settings.EnabledSources = []Source{StreamlabsSource, StreamlabsSource}
	if err := settings.Validate(); err == nil {
		t.Fatal("duplicate source was accepted")
	}
}

func TestPlaybackJSONUsesLosslessDonationIDAndPublicKind(t *testing.T) {
	donationID := int64(9_007_199_254_740_993)
	encoded, err := json.Marshal(Playback{
		PlaybackID:        "c2723d6f-6d80-4abd-8456-b66bfc593a12",
		DonationID:        &donationID,
		Kind:              IncomingPlayback,
		State:             PendingStatus,
		Amount:            "10.00",
		Currency:          "RUB",
		DisplayDurationMS: 7000,
		AccentColor:       "#f59e0b",
		CreatedAt:         time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded["donationId"] != "9007199254740993" {
		t.Fatalf("donationId = %#v, JSON = %s", decoded["donationId"], encoded)
	}
	if decoded["kind"] != "incoming" {
		t.Fatalf("kind = %#v, JSON = %s", decoded["kind"], encoded)
	}
	count := 0
	for key := range decoded {
		if key == "donationId" {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("donationId fields = %d, JSON = %s", count, encoded)
	}

	encoded, err = json.Marshal(Playback{Kind: TestPlayback})
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	if value, exists := decoded["donationId"]; !exists || value != nil {
		t.Fatalf("nullable donationId = %#v, exists=%v, JSON = %s", value, exists, encoded)
	}
}

func TestDiagnosticForPlaybackUsesStableClassificationAndBestTimestamp(t *testing.T) {
	createdAt := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	startedAt := createdAt.Add(time.Second)
	finishedAt := startedAt.Add(time.Second)
	detail := string(PlaybackTimeoutDiagnostic)
	diagnostic := diagnosticForPlayback(Playback{
		Detail: &detail, CreatedAt: createdAt, StartedAt: &startedAt, FinishedAt: &finishedAt,
	})
	if diagnostic == nil || diagnostic.Code != PlaybackTimeoutDiagnostic || diagnostic.Level != DiagnosticError {
		t.Fatalf("diagnostic = %#v", diagnostic)
	}
	if !diagnostic.OccurredAt.Equal(finishedAt) {
		t.Fatalf("occurredAt = %v, want %v", diagnostic.OccurredAt, finishedAt)
	}
	if diagnostic.Detail == detail || diagnostic.Detail == "" {
		t.Fatalf("diagnostic detail should be a stable description, got %q", diagnostic.Detail)
	}

	legacyDetail := "private implementation detail"
	diagnostic = diagnosticForPlayback(Playback{Detail: &legacyDetail, CreatedAt: createdAt})
	if diagnostic == nil || diagnostic.Code != PlaybackIssueDiagnostic || diagnostic.Detail == legacyDetail {
		t.Fatalf("legacy diagnostic = %#v", diagnostic)
	}
}
