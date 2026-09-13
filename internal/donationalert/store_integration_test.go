package donationalert

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

var alertTestSchemaSequence atomic.Uint64

func TestConcurrentPlayerOpenCreatesOneActiveLease(t *testing.T) {
	store, pool := newAlertIntegrationStore(t)
	seedAlertUser(t, pool, 1)
	ctx := context.Background()
	now := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	tokenHash := hashToken("12345678901234567890123456789012")
	if err := store.SetOverlayTokenHash(ctx, 1, tokenHash, now); err != nil {
		t.Fatal(err)
	}
	candidates := []string{
		"c2723d6f-6d80-4abd-8456-b66bfc593a12",
		"f263a56a-1b02-48b5-982a-08a4e84f9887",
	}
	type result struct {
		player Player
		err    error
	}
	results := make(chan result, len(candidates))
	start := make(chan struct{})
	var waitGroup sync.WaitGroup
	for _, candidate := range candidates {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			<-start
			_, player, err := store.OpenPlayer(ctx, tokenHash, candidate, now)
			results <- result{player: player, err: err}
		}()
	}
	close(start)
	waitGroup.Wait()
	close(results)
	active, standby := 0, 0
	for result := range results {
		if result.err != nil {
			t.Fatal(result.err)
		}
		switch result.player.State {
		case "active":
			active++
		case "standby":
			standby++
		}
		if result.player.Generation <= 0 {
			t.Fatalf("player generation = %d", result.player.Generation)
		}
	}
	if active != 1 || standby != 1 {
		t.Fatalf("active=%d standby=%d", active, standby)
	}
}

func TestPlayerLeaseClaimAndTokenRotation(t *testing.T) {
	store, pool := newAlertIntegrationStore(t)
	seedAlertUser(t, pool, 1)
	ctx := context.Background()
	settings := DefaultSettings()
	settings.Enabled = true
	if _, err := store.UpdateSettings(ctx, 1, settings); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	tokenHash := hashToken("12345678901234567890123456789012")
	if err := store.SetOverlayTokenHash(ctx, 1, tokenHash, now); err != nil {
		t.Fatal(err)
	}
	_, err := store.CreateTest(ctx, 1, now)
	if err != nil {
		t.Fatal(err)
	}
	queuedPlayback, err := store.CreateTest(ctx, 1, now.Add(time.Millisecond))
	if err != nil || queuedPlayback.Kind != TestPlayback || queuedPlayback.DonationID != nil {
		t.Fatalf("queued playback=%#v error=%v", queuedPlayback, err)
	}
	playerID := "c2723d6f-6d80-4abd-8456-b66bfc593a12"
	_, player, err := store.OpenPlayer(ctx, tokenHash, playerID, now)
	if err != nil || player.State != "active" || player.Generation <= 0 || player.Active || player.Visible {
		t.Fatalf("player=%#v error=%v", player, err)
	}
	if err := store.Heartbeat(ctx, tokenHash, playerID, player.Generation, true, true, now); err != nil {
		t.Fatal(err)
	}
	type claimResult struct {
		playback *Playback
		err      error
	}
	claims := make(chan claimResult, 2)
	claimStart := make(chan struct{})
	var claimWaitGroup sync.WaitGroup
	for range 2 {
		claimWaitGroup.Add(1)
		go func() {
			defer claimWaitGroup.Done()
			<-claimStart
			playback, err := store.ClaimPlayback(ctx, tokenHash, playerID, player.Generation, now)
			claims <- claimResult{playback: playback, err: err}
		}()
	}
	close(claimStart)
	claimWaitGroup.Wait()
	close(claims)
	var playback *Playback
	claimed := 0
	for result := range claims {
		if result.err != nil {
			t.Fatal(result.err)
		}
		if result.playback != nil {
			claimed++
			playback = result.playback
		}
	}
	if claimed != 1 || playback == nil || playback.State != PlayingStatus {
		t.Fatalf("claimed=%d playback=%#v", claimed, playback)
	}
	if err := store.StartPlayback(ctx, tokenHash, playerID, player.Generation, playback.PlaybackID, now.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	_, standby, err := store.OpenPlayer(ctx, tokenHash, "f263a56a-1b02-48b5-982a-08a4e84f9887", now.Add(time.Second))
	if err != nil || standby.State != "standby" || standby.Generation <= 0 {
		t.Fatalf("standby=%#v error=%v", standby, err)
	}
	if err := store.SetOverlayTokenHash(ctx, 1, hashToken("abcdefghijklmnopqrstuvwxyz123456"), now.Add(2*time.Second)); err != nil {
		t.Fatal(err)
	}
	_, _, err = store.StreamState(ctx, tokenHash, playerID, player.Generation, now.Add(2*time.Second))
	if !errors.Is(err, ErrLeaseLost) {
		t.Fatalf("old player error=%v", err)
	}
	status, err := store.PlaybackStatus(ctx, playback.PlaybackID)
	if err != nil || status != InterruptedStatus {
		t.Fatalf("status=%q error=%v", status, err)
	}
}

func TestCompositeAssetOwnershipConstraint(t *testing.T) {
	store, pool := newAlertIntegrationStore(t)
	seedAlertUser(t, pool, 1)
	seedAlertUser(t, pool, 2)
	ctx := context.Background()
	if err := store.EnsureConfiguration(ctx, 1); err != nil {
		t.Fatal(err)
	}
	asset, err := store.SaveAsset(ctx, 2, ImageAsset, Media{MIMEType: "image/png", Content: []byte("content")}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		UPDATE donation_alert_configuration
		SET image_asset_id = $2
		WHERE user_id = $1
	`, 1, asset.AssetID); err == nil {
		t.Fatal("cross-user asset reference was accepted")
	}
}

func TestRetentionPrunesHistoryAndRetiredMedia(t *testing.T) {
	store, pool := newAlertIntegrationStore(t)
	ctx := context.Background()
	base := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)

	seedAlertUser(t, pool, 900)
	playbackIDs := make([]string, 0, MaxRetainedTerminalPlaybacks+3)
	for index := range MaxRetainedTerminalPlaybacks + 3 {
		createdAt := base.Add(time.Duration(index) * time.Second)
		playback, err := store.CreateTest(ctx, 900, createdAt)
		if err != nil {
			t.Fatal(err)
		}
		playbackIDs = append(playbackIDs, playback.PlaybackID)
		if _, err := pool.Exec(ctx, `
			UPDATE donation_alert_playback
			SET status = 'completed', started_at = $2, finished_at = $2
			WHERE donation_alert_playback_id = $1
		`, playback.PlaybackID, createdAt.Add(time.Millisecond)); err != nil {
			t.Fatal(err)
		}
	}
	if err := store.PruneRetention(ctx, base.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	var retained int
	if err := pool.QueryRow(ctx, `
		SELECT count(*)
		FROM donation_alert_playback
		WHERE user_id = 900
	`).Scan(&retained); err != nil {
		t.Fatal(err)
	}
	if retained != MaxRetainedTerminalPlaybacks {
		t.Fatalf("retained playbacks = %d, want %d", retained, MaxRetainedTerminalPlaybacks)
	}
	if _, err := store.Playback(ctx, playbackIDs[0]); !errors.Is(err, ErrNotFound) {
		t.Fatalf("oldest playback error = %v", err)
	}
	if _, err := store.Playback(ctx, playbackIDs[len(playbackIDs)-1]); err != nil {
		t.Fatalf("latest playback was pruned: %v", err)
	}

	seedAlertUser(t, pool, 901)
	oldAt := base.Add(-TerminalPlaybackRetention - time.Second)
	oldPlayback, err := store.CreateTest(ctx, 901, oldAt)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		UPDATE donation_alert_playback
		SET status = 'completed', started_at = $2, finished_at = $2
		WHERE donation_alert_playback_id = $1
	`, oldPlayback.PlaybackID, oldAt.Add(time.Millisecond)); err != nil {
		t.Fatal(err)
	}
	if err := store.PruneRetention(ctx, base); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Playback(ctx, oldPlayback.PlaybackID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expired retained playback error = %v", err)
	}

	seedAlertUser(t, pool, 902)
	retiredAsset, err := store.SaveAsset(ctx, 902, ImageAsset, Media{MIMEType: "image/png", Content: []byte("retired")}, base)
	if err != nil {
		t.Fatal(err)
	}
	terminalPlayback, err := store.CreateTest(ctx, 902, base)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		UPDATE donation_alert_playback
		SET status = 'completed', started_at = $2, finished_at = $2
		WHERE donation_alert_playback_id = $1
	`, terminalPlayback.PlaybackID, base.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if _, err := store.SaveAsset(ctx, 902, ImageAsset, Media{MIMEType: "image/png", Content: []byte("selected")}, base.Add(2*time.Second)); err != nil {
		t.Fatal(err)
	}
	if err := store.DeleteAsset(ctx, 902, retiredAsset.AssetID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.AssetForUser(ctx, 902, retiredAsset.AssetID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("retired terminal asset error = %v", err)
	}

	queuedAsset, err := store.SaveAsset(ctx, 902, ImageAsset, Media{MIMEType: "image/png", Content: []byte("queued")}, base.Add(3*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	queuedPlayback, err := store.CreateTest(ctx, 902, base.Add(3*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.SaveAsset(ctx, 902, ImageAsset, Media{MIMEType: "image/png", Content: []byte("replacement")}, base.Add(4*time.Second)); err != nil {
		t.Fatal(err)
	}
	if err := store.DeleteAsset(ctx, 902, queuedAsset.AssetID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.PlayerAssetForUser(ctx, 902, queuedAsset.AssetID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("pending player asset error = %v", err)
	}
	if _, err := pool.Exec(ctx, `
		UPDATE donation_alert_playback
		SET status = 'playing'
		WHERE donation_alert_playback_id = $1
	`, queuedPlayback.PlaybackID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.PlayerAssetForUser(ctx, 902, queuedAsset.AssetID); err != nil {
		t.Fatalf("playing asset was unavailable: %v", err)
	}
	var ttsAssetID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO donation_alert_asset (
			user_id, kind, mime_type, content, content_hash, duration_ms, created_at
		)
		VALUES (902, 'tts', 'audio/ogg', 'tts', repeat('a', 64), 100, $1)
		RETURNING donation_alert_asset_id::text
	`, base.Add(5*time.Second)).Scan(&ttsAssetID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		UPDATE donation_alert_playback
		SET status = 'completed', started_at = $2, finished_at = $2, tts_asset_id = $3
		WHERE donation_alert_playback_id = $1
	`, queuedPlayback.PlaybackID, base.Add(6*time.Second), ttsAssetID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.PlayerAssetForUser(ctx, 902, queuedAsset.AssetID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("terminal player asset error = %v", err)
	}
	if err := store.PruneRetention(ctx, base.Add(7*time.Second)); err != nil {
		t.Fatal(err)
	}
	for _, assetID := range []string{queuedAsset.AssetID, ttsAssetID} {
		if _, err := store.AssetForUser(ctx, 902, assetID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("orphaned asset %s error = %v", assetID, err)
		}
	}
}

func TestPreparationCrashAfterLastAttemptFallsBackToPending(t *testing.T) {
	store, pool := newAlertIntegrationStore(t)
	seedAlertUser(t, pool, 1)
	ctx := context.Background()
	settings := DefaultSettings()
	settings.TTSEnabled = true
	if _, err := store.UpdateSettings(ctx, 1, settings); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	playback, err := store.CreateTest(ctx, 1, now)
	if err != nil {
		t.Fatal(err)
	}
	first, err := store.ClaimPreparation(ctx, now)
	if err != nil || first == nil {
		t.Fatalf("first preparation=%#v error=%v", first, err)
	}
	if err := store.FailPreparation(ctx, *first, "retry one", now); err != nil {
		t.Fatal(err)
	}
	second, err := store.ClaimPreparation(ctx, now.Add(time.Second))
	if err != nil || second == nil {
		t.Fatalf("second preparation=%#v error=%v", second, err)
	}
	if err := store.FailPreparation(ctx, *second, "retry two", now.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	third, err := store.ClaimPreparation(ctx, now.Add(3*time.Second))
	if err != nil || third == nil || third.Attempts != PreparationTries {
		t.Fatalf("third preparation=%#v error=%v", third, err)
	}
	claimed, err := store.ClaimPreparation(ctx, now.Add(3*time.Second+PreparationLease))
	if err != nil || claimed != nil {
		t.Fatalf("post-crash claim=%#v error=%v", claimed, err)
	}
	playback, err = store.Playback(ctx, playback.PlaybackID)
	if err != nil || playback.State != PendingStatus || playback.Detail == nil {
		t.Fatalf("fallback playback=%#v error=%v", playback, err)
	}
}

func newAlertIntegrationStore(t *testing.T) (*Store, *pgxpool.Pool) {
	t.Helper()
	databaseURL := os.Getenv("DONATION_ALERT_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DONATION_ALERT_TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	schema := fmt.Sprintf("donation_alert_test_%d_%d", os.Getpid(), alertTestSchemaSequence.Add(1))
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		admin.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = admin.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
		admin.Close()
	})

	database, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	query := database.Query()
	query.Set("search_path", schema)
	database.RawQuery = query.Encode()
	repositoryRoot, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	command := exec.Command(filepath.Join(repositoryRoot, "node_modules", ".bin", "dbmate"), "--no-dump-schema", "up")
	command.Dir = repositoryRoot
	command.Env = append(os.Environ(), "DATABASE_URL="+database.String())
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("apply test migrations: %v\n%s", err, output)
	}
	pool, err := pgxpool.New(ctx, database.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return NewStore(pool), pool
}

func seedAlertUser(t *testing.T, pool *pgxpool.Pool, userID int) {
	t.Helper()
	authID := fmt.Sprintf("alert-user-%d", userID)
	email := fmt.Sprintf("alert-user-%d@example.com", userID)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `
		INSERT INTO auth_user (id, name, email, "emailVerified")
		VALUES ($1, 'Alert Test', $2, true)
	`, authID, email); err != nil {
		t.Fatal(err)
	}
	_, err := pool.Exec(ctx, `
		INSERT INTO "user" (user_id, auth_user_id)
		OVERRIDING SYSTEM VALUE
		VALUES ($1, $2)
	`, userID, authID)
	if err != nil {
		t.Fatal(err)
	}
}
