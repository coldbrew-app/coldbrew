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

func TestDashboardReportsOnlyActiveStreamElementsConnection(t *testing.T) {
	store, pool := newAlertIntegrationStore(t)
	seedAlertUser(t, pool, 1)
	ctx := context.Background()
	if err := store.EnsureConfiguration(ctx, 1); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO streamelements_connection (
			user_id,
			source_user_id,
			access_token,
			refresh_token
		)
		VALUES (1, 'channel', 'access', 'refresh')
	`); err != nil {
		t.Fatal(err)
	}

	dashboard, err := store.Dashboard(ctx, 1, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if len(dashboard.ConnectedSources) != 1 || dashboard.ConnectedSources[0] != StreamElementsSource {
		t.Fatalf("connected sources = %#v", dashboard.ConnectedSources)
	}
	if _, execErr := pool.Exec(ctx, `
		UPDATE streamelements_connection
		SET status = 'error'
		WHERE user_id = 1
	`); execErr != nil {
		t.Fatal(execErr)
	}

	dashboard, err = store.Dashboard(ctx, 1, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if len(dashboard.ConnectedSources) != 0 {
		t.Fatalf("inactive StreamElements source remained connected: %#v", dashboard.ConnectedSources)
	}
}

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
	if _, createErr := store.CreateTest(ctx, 1, now); createErr != nil {
		t.Fatal(createErr)
	}
	queuedPlayback, queueErr := store.CreateTest(ctx, 1, now.Add(time.Millisecond))
	if queueErr != nil || queuedPlayback.Kind != TestPlayback || queuedPlayback.DonationID != nil {
		t.Fatalf("queued playback=%#v error=%v", queuedPlayback, queueErr)
	}
	playerID := "c2723d6f-6d80-4abd-8456-b66bfc593a12"
	_, player, openErr := store.OpenPlayer(ctx, tokenHash, playerID, now)
	if openErr != nil || player.State != "active" || player.Generation <= 0 || player.Active || player.Visible {
		t.Fatalf("player=%#v error=%v", player, openErr)
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
	_, standby, standbyErr := store.OpenPlayer(ctx, tokenHash, "f263a56a-1b02-48b5-982a-08a4e84f9887", now.Add(time.Second))
	if standbyErr != nil || standby.State != "standby" || standby.Generation <= 0 {
		t.Fatalf("standby=%#v error=%v", standby, standbyErr)
	}
	if err := store.SetOverlayTokenHash(ctx, 1, hashToken("abcdefghijklmnopqrstuvwxyz123456"), now.Add(2*time.Second)); err != nil {
		t.Fatal(err)
	}
	_, _, streamErr := store.StreamState(ctx, tokenHash, playerID, player.Generation, now.Add(2*time.Second))
	if !errors.Is(streamErr, ErrLeaseLost) {
		t.Fatalf("old player error=%v", streamErr)
	}
	status, statusErr := store.PlaybackStatus(ctx, playback.PlaybackID)
	if statusErr != nil || status != InterruptedStatus {
		t.Fatalf("status=%q error=%v", status, statusErr)
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
	oldPlayback, oldPlaybackErr := store.CreateTest(ctx, 901, oldAt)
	if oldPlaybackErr != nil {
		t.Fatal(oldPlaybackErr)
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
	retiredAsset, retiredAssetErr := store.SaveAsset(ctx, 902, ImageAsset, Media{MIMEType: "image/png", Content: []byte("retired")}, base)
	if retiredAssetErr != nil {
		t.Fatal(retiredAssetErr)
	}
	terminalPlayback, terminalPlaybackErr := store.CreateTest(ctx, 902, base)
	if terminalPlaybackErr != nil {
		t.Fatal(terminalPlaybackErr)
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

	queuedAsset, queuedAssetErr := store.SaveAsset(ctx, 902, ImageAsset, Media{MIMEType: "image/png", Content: []byte("queued")}, base.Add(3*time.Second))
	if queuedAssetErr != nil {
		t.Fatal(queuedAssetErr)
	}
	queuedPlayback, queuedPlaybackErr := store.CreateTest(ctx, 902, base.Add(3*time.Second))
	if queuedPlaybackErr != nil {
		t.Fatal(queuedPlaybackErr)
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
	playback, playbackErr := store.CreateTest(ctx, 1, now)
	if playbackErr != nil {
		t.Fatal(playbackErr)
	}
	first, firstErr := store.ClaimPreparation(ctx, now)
	if firstErr != nil || first == nil {
		t.Fatalf("first preparation=%#v error=%v", first, firstErr)
	}
	if err := store.FailPreparation(ctx, *first, "retry one", now); err != nil {
		t.Fatal(err)
	}
	second, secondErr := store.ClaimPreparation(ctx, now.Add(time.Second))
	if secondErr != nil || second == nil {
		t.Fatalf("second preparation=%#v error=%v", second, secondErr)
	}
	if err := store.FailPreparation(ctx, *second, "retry two", now.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	third, thirdErr := store.ClaimPreparation(ctx, now.Add(3*time.Second))
	if thirdErr != nil || third == nil || third.Attempts != PreparationTries {
		t.Fatalf("third preparation=%#v error=%v", third, thirdErr)
	}
	claimed, claimErr := store.ClaimPreparation(ctx, now.Add(3*time.Second+PreparationLease))
	if claimErr != nil || claimed != nil {
		t.Fatalf("post-crash claim=%#v error=%v", claimed, claimErr)
	}
	playback, playbackErr = store.Playback(ctx, playback.PlaybackID)
	if playbackErr != nil || playback.State != PendingStatus || playback.Detail == nil {
		t.Fatalf("fallback playback=%#v error=%v", playback, playbackErr)
	}
}

func newAlertIntegrationStore(t *testing.T) (*Store, *pgxpool.Pool) {
	t.Helper()
	databaseURL := os.Getenv("DONATION_ALERT_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DONATION_ALERT_TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	admin, adminErr := pgxpool.New(ctx, databaseURL)
	if adminErr != nil {
		t.Fatal(adminErr)
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

	database, parseErr := url.Parse(databaseURL)
	if parseErr != nil {
		t.Fatal(parseErr)
	}
	query := database.Query()
	query.Set("search_path", schema)
	database.RawQuery = query.Encode()
	repositoryRoot, rootErr := filepath.Abs("../..")
	if rootErr != nil {
		t.Fatal(rootErr)
	}
	//nolint:gosec // The executable path is anchored to this repository's dependency directory.
	command := exec.Command(filepath.Join(repositoryRoot, "node_modules", ".bin", "dbmate"), "--no-dump-schema", "up")
	command.Dir = repositoryRoot
	command.Env = append(os.Environ(), "DATABASE_URL="+database.String())
	if output, migrationErr := command.CombinedOutput(); migrationErr != nil {
		t.Fatalf("apply test migrations: %v\n%s", migrationErr, output)
	}
	pool, poolErr := pgxpool.New(ctx, database.String())
	if poolErr != nil {
		t.Fatal(poolErr)
	}
	t.Cleanup(pool.Close)
	return NewStore(pool), pool
}

func seedAlertUser(t *testing.T, pool *pgxpool.Pool, userID int) {
	seedAlertUserContext(t, context.Background(), pool, userID)
}

func seedAlertUserContext(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID int) {
	t.Helper()
	authID := fmt.Sprintf("alert-user-%d", userID)
	email := fmt.Sprintf("alert-user-%d@example.com", userID)
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
