package donationalert

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type claimedTestPlayback struct {
	tokenHash  string
	playerID   string
	generation int64
	playback   *Playback
}

func setupClaimedTestPlayback(
	t *testing.T,
	ctx context.Context,
	store *Store,
	pool *pgxpool.Pool,
	userID int,
	now time.Time,
) claimedTestPlayback {
	t.Helper()
	seedAlertUserContext(t, ctx, pool, userID)
	settings := DefaultSettings()
	settings.Enabled = true
	if _, err := store.UpdateSettings(ctx, userID, settings); err != nil {
		t.Fatal(err)
	}
	token := fmt.Sprintf("%032d", userID)
	tokenHash := hashToken(token)
	if err := store.SetOverlayTokenHash(ctx, userID, tokenHash, now); err != nil {
		t.Fatal(err)
	}
	queued, err := store.CreateTest(ctx, userID, now)
	if err != nil {
		t.Fatal(err)
	}
	playerID, err := randomUUID()
	if err != nil {
		t.Fatal(err)
	}
	_, player, err := store.OpenPlayer(ctx, tokenHash, playerID, now)
	if err != nil {
		t.Fatal(err)
	}
	if player.Active || player.Visible {
		t.Fatalf("new player was ready before its first heartbeat: %#v", player)
	}
	if heartbeatErr := store.Heartbeat(ctx, tokenHash, playerID, player.Generation, true, true, now); heartbeatErr != nil {
		t.Fatal(heartbeatErr)
	}
	claimed, err := store.ClaimPlayback(ctx, tokenHash, playerID, player.Generation, now)
	if err != nil {
		t.Fatal(err)
	}
	if claimed == nil || claimed.PlaybackID != queued.PlaybackID || claimed.StartedAt != nil {
		t.Fatalf("claimed playback = %#v, queued = %#v", claimed, queued)
	}
	return claimedTestPlayback{
		tokenHash: tokenHash, playerID: playerID, generation: player.Generation, playback: claimed,
	}
}

type storedPlaybackLifecycle struct {
	status           PlaybackStatus
	startedAt        *time.Time
	finishedAt       *time.Time
	playerID         *string
	playerGeneration *int64
	detail           *string
}

func readPlaybackLifecycle(t *testing.T, ctx context.Context, pool *pgxpool.Pool, playbackID string) storedPlaybackLifecycle {
	t.Helper()
	var result storedPlaybackLifecycle
	if err := pool.QueryRow(ctx, `
		SELECT status::text, started_at, finished_at, player_id::text, player_generation, last_error
		FROM donation_alert_playback
		WHERE donation_alert_playback_id = $1
	`, playbackID).Scan(
		&result.status,
		&result.startedAt,
		&result.finishedAt,
		&result.playerID,
		&result.playerGeneration,
		&result.detail,
	); err != nil {
		t.Fatal(err)
	}
	return result
}

func TestUnstartedPlaybackRecoversAcrossPlayerLifecycle(t *testing.T) {
	store, pool := newAlertIntegrationStore(t)
	base := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	ctx := context.Background()
	tests := []struct {
		name       string
		actionAt   time.Duration
		wantStatus PlaybackStatus
		wantError  error
		action     func(int, claimedTestPlayback, time.Time) error
	}{
		{
			name: "release", actionAt: time.Second, wantStatus: PendingStatus,
			action: func(_ int, claimed claimedTestPlayback, now time.Time) error {
				return store.ReleasePlayer(ctx, claimed.tokenHash, claimed.playerID, claimed.generation, now)
			},
		},
		{
			name: "hidden", actionAt: time.Second, wantStatus: PendingStatus,
			action: func(_ int, claimed claimedTestPlayback, now time.Time) error {
				return store.Heartbeat(ctx, claimed.tokenHash, claimed.playerID, claimed.generation, true, false, now)
			},
		},
		{
			name: "expired lease", actionAt: PlayerLease, wantStatus: PendingStatus, wantError: ErrLeaseLost,
			action: func(_ int, claimed claimedTestPlayback, now time.Time) error {
				return store.Heartbeat(ctx, claimed.tokenHash, claimed.playerID, claimed.generation, true, true, now)
			},
		},
		{
			name: "token rotation", actionAt: time.Second, wantStatus: PendingStatus,
			action: func(userID int, _ claimedTestPlayback, now time.Time) error {
				return store.SetOverlayTokenHash(ctx, userID, hashToken(fmt.Sprintf("rotated-%024d", userID)), now)
			},
		},
		{
			name: "expired before release", actionAt: MaxAlertAge, wantStatus: ExpiredStatus,
			action: func(_ int, claimed claimedTestPlayback, now time.Time) error {
				return store.ReleasePlayer(ctx, claimed.tokenHash, claimed.playerID, claimed.generation, now)
			},
		},
	}
	for index, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			userID := 100 + index
			claimed := setupClaimedTestPlayback(t, ctx, store, pool, userID, base)
			err := test.action(userID, claimed, base.Add(test.actionAt))
			if !errors.Is(err, test.wantError) {
				t.Fatalf("action error = %v, want %v", err, test.wantError)
			}
			stored := readPlaybackLifecycle(t, ctx, pool, claimed.playback.PlaybackID)
			if stored.status != test.wantStatus || stored.startedAt != nil {
				t.Fatalf("lifecycle = %#v, want status %q with no start", stored, test.wantStatus)
			}
			if stored.playerID != nil || stored.playerGeneration != nil {
				t.Fatalf("recovered player identity was retained: %#v", stored)
			}
			if test.wantStatus == PendingStatus && (stored.finishedAt != nil || stored.detail != nil) {
				t.Fatalf("fresh playback was made terminal: %#v", stored)
			}
			if test.wantStatus == ExpiredStatus && (stored.finishedAt == nil || stored.detail == nil || *stored.detail != string(AlertExpiredDiagnostic)) {
				t.Fatalf("expired playback = %#v", stored)
			}
		})
	}
}

func TestAcknowledgedPlaybackIsInterruptedAcrossPlayerLifecycle(t *testing.T) {
	store, pool := newAlertIntegrationStore(t)
	base := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	ctx := context.Background()
	tests := []struct {
		name     string
		actionAt time.Duration
		action   func(int, claimedTestPlayback, time.Time) error
		wantErr  error
		wantCode DiagnosticCode
	}{
		{
			name: "release", actionAt: 2 * time.Second, wantCode: PlayerDisconnectedDiagnostic,
			action: func(_ int, claimed claimedTestPlayback, now time.Time) error {
				return store.ReleasePlayer(ctx, claimed.tokenHash, claimed.playerID, claimed.generation, now)
			},
		},
		{
			name: "hidden", actionAt: 2 * time.Second, wantCode: PlayerDisconnectedDiagnostic,
			action: func(_ int, claimed claimedTestPlayback, now time.Time) error {
				return store.Heartbeat(ctx, claimed.tokenHash, claimed.playerID, claimed.generation, false, true, now)
			},
		},
		{
			name: "expired lease", actionAt: PlayerLease, wantErr: ErrLeaseLost, wantCode: PlayerDisconnectedDiagnostic,
			action: func(_ int, claimed claimedTestPlayback, now time.Time) error {
				return store.Heartbeat(ctx, claimed.tokenHash, claimed.playerID, claimed.generation, true, true, now)
			},
		},
		{
			name: "token rotation", actionAt: 2 * time.Second, wantCode: OverlayRotatedDiagnostic,
			action: func(userID int, _ claimedTestPlayback, now time.Time) error {
				return store.SetOverlayTokenHash(ctx, userID, hashToken(fmt.Sprintf("rotated-%024d", userID)), now)
			},
		},
	}
	for index, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			userID := 200 + index
			claimed := setupClaimedTestPlayback(t, ctx, store, pool, userID, base)
			if err := store.StartPlayback(ctx, claimed.tokenHash, claimed.playerID, claimed.generation, claimed.playback.PlaybackID, base.Add(time.Second)); err != nil {
				t.Fatal(err)
			}
			err := test.action(userID, claimed, base.Add(test.actionAt))
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("action error = %v, want %v", err, test.wantErr)
			}
			stored := readPlaybackLifecycle(t, ctx, pool, claimed.playback.PlaybackID)
			if stored.status != InterruptedStatus || stored.startedAt == nil || stored.finishedAt == nil {
				t.Fatalf("acknowledged playback lifecycle = %#v", stored)
			}
			if stored.detail == nil || *stored.detail != string(test.wantCode) {
				t.Fatalf("diagnostic = %v, want %q", stored.detail, test.wantCode)
			}
		})
	}
}

func TestClaimPreservesSequenceBehindEarlierPreparation(t *testing.T) {
	store, pool := newAlertIntegrationStore(t)
	seedAlertUser(t, pool, 300)
	ctx := context.Background()
	base := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	settings := DefaultSettings()
	settings.Enabled = true
	settings.TTSEnabled = true
	if _, err := store.UpdateSettings(ctx, 300, settings); err != nil {
		t.Fatal(err)
	}
	first, firstErr := store.CreateTest(ctx, 300, base)
	if firstErr != nil {
		t.Fatal(firstErr)
	}
	settings.TTSEnabled = false
	if _, err := store.UpdateSettings(ctx, 300, settings); err != nil {
		t.Fatal(err)
	}
	second, secondErr := store.CreateTest(ctx, 300, base.Add(time.Millisecond))
	if secondErr != nil {
		t.Fatal(secondErr)
	}
	tokenHash := hashToken(fmt.Sprintf("%032d", 300))
	if err := store.SetOverlayTokenHash(ctx, 300, tokenHash, base); err != nil {
		t.Fatal(err)
	}
	playerID, _ := randomUUID()
	_, player, openErr := store.OpenPlayer(ctx, tokenHash, playerID, base)
	if openErr != nil {
		t.Fatal(openErr)
	}
	if err := store.Heartbeat(ctx, tokenHash, playerID, player.Generation, true, true, base); err != nil {
		t.Fatal(err)
	}
	claimed, claimErr := store.ClaimPlayback(ctx, tokenHash, playerID, player.Generation, base.Add(time.Second))
	if claimErr != nil || claimed != nil {
		t.Fatalf("later pending playback bypassed preparation: playback=%#v error=%v", claimed, claimErr)
	}
	preparation, preparationErr := store.ClaimPreparation(ctx, base.Add(time.Second))
	if preparationErr != nil || preparation == nil || preparation.PlaybackID != first.PlaybackID {
		t.Fatalf("preparation=%#v error=%v", preparation, preparationErr)
	}
	if err := store.CompletePreparation(ctx, *preparation, Media{MIMEType: "audio/ogg", Content: []byte("tts")}, base.Add(2*time.Second)); err != nil {
		t.Fatal(err)
	}
	claimed, claimErr = store.ClaimPlayback(ctx, tokenHash, playerID, player.Generation, base.Add(2*time.Second))
	if claimErr != nil || claimed == nil || claimed.PlaybackID != first.PlaybackID {
		t.Fatalf("claim=%#v error=%v, want first=%s before second=%s", claimed, claimErr, first.PlaybackID, second.PlaybackID)
	}
}

func TestClaimPreservesSequenceBehindEarlierUnavailablePending(t *testing.T) {
	store, pool := newAlertIntegrationStore(t)
	seedAlertUser(t, pool, 301)
	ctx := context.Background()
	base := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	settings := DefaultSettings()
	settings.Enabled = true
	if _, err := store.UpdateSettings(ctx, 301, settings); err != nil {
		t.Fatal(err)
	}
	first, firstErr := store.CreateTest(ctx, 301, base)
	if firstErr != nil {
		t.Fatal(firstErr)
	}
	second, secondErr := store.CreateTest(ctx, 301, base.Add(time.Millisecond))
	if secondErr != nil {
		t.Fatal(secondErr)
	}
	if _, err := pool.Exec(ctx, `
		UPDATE donation_alert_playback SET available_at = $2
		WHERE donation_alert_playback_id = $1
	`, first.PlaybackID, base.Add(10*time.Second)); err != nil {
		t.Fatal(err)
	}
	tokenHash := hashToken(fmt.Sprintf("%032d", 301))
	if err := store.SetOverlayTokenHash(ctx, 301, tokenHash, base); err != nil {
		t.Fatal(err)
	}
	playerID, _ := randomUUID()
	_, player, openErr := store.OpenPlayer(ctx, tokenHash, playerID, base)
	if openErr != nil {
		t.Fatal(openErr)
	}
	if err := store.Heartbeat(ctx, tokenHash, playerID, player.Generation, true, true, base); err != nil {
		t.Fatal(err)
	}
	claimed, claimErr := store.ClaimPlayback(ctx, tokenHash, playerID, player.Generation, base.Add(time.Second))
	if claimErr != nil || claimed != nil {
		t.Fatalf("later pending playback bypassed unavailable head: playback=%#v error=%v", claimed, claimErr)
	}
	claimed, claimErr = store.ClaimPlayback(ctx, tokenHash, playerID, player.Generation, base.Add(10*time.Second))
	if claimErr != nil || claimed == nil || claimed.PlaybackID != first.PlaybackID {
		t.Fatalf("claim=%#v error=%v, want first=%s before second=%s", claimed, claimErr, first.PlaybackID, second.PlaybackID)
	}
}

func TestQueueLockHidesUncommittedHeadFromClaim(t *testing.T) {
	store, pool := newAlertIntegrationStore(t)
	seedAlertUser(t, pool, 302)
	ctx := context.Background()
	base := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	settings := DefaultSettings()
	settings.Enabled = true
	if _, err := store.UpdateSettings(ctx, 302, settings); err != nil {
		t.Fatal(err)
	}
	donationID := insertAlertDonation(t, pool, 302, "uncommitted-head", base)
	tokenHash := hashToken(fmt.Sprintf("%032d", 302))
	if err := store.SetOverlayTokenHash(ctx, 302, tokenHash, base); err != nil {
		t.Fatal(err)
	}
	playerID, _ := randomUUID()
	_, player, openErr := store.OpenPlayer(ctx, tokenHash, playerID, base)
	if openErr != nil {
		t.Fatal(openErr)
	}
	if err := store.Heartbeat(ctx, tokenHash, playerID, player.Generation, true, true, base); err != nil {
		t.Fatal(err)
	}
	tx, beginErr := pool.Begin(ctx)
	if beginErr != nil {
		t.Fatal(beginErr)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := EnqueueIncoming(ctx, tx, 302, donationID, DonationAlertsSource, base); err != nil {
		t.Fatal(err)
	}
	claimCtx, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
	defer cancel()
	if _, err := store.ClaimPlayback(claimCtx, tokenHash, playerID, player.Generation, base); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("claim did not wait for the uncommitted queue head: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	claimed, claimErr := store.ClaimPlayback(ctx, tokenHash, playerID, player.Generation, base)
	if claimErr != nil || claimed == nil || claimed.DonationID == nil || *claimed.DonationID != donationID {
		t.Fatalf("claim after commit=%#v error=%v", claimed, claimErr)
	}
}

func TestConcurrentEnqueueKeepsBacklogBound(t *testing.T) {
	store, pool := newAlertIntegrationStore(t)
	seedAlertUser(t, pool, 303)
	ctx := context.Background()
	base := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	settings := DefaultSettings()
	settings.Enabled = true
	if _, err := store.UpdateSettings(ctx, 303, settings); err != nil {
		t.Fatal(err)
	}
	for index := 0; index < MaxPendingAlerts; index++ {
		if _, err := store.CreateTest(ctx, 303, base.Add(time.Duration(index)*time.Millisecond)); err != nil {
			t.Fatal(err)
		}
	}
	firstDonationID := insertAlertDonation(t, pool, 303, "concurrent-one", base)
	secondDonationID := insertAlertDonation(t, pool, 303, "concurrent-two", base)
	firstTx, firstTxErr := pool.Begin(ctx)
	if firstTxErr != nil {
		t.Fatal(firstTxErr)
	}
	defer func() { _ = firstTx.Rollback(ctx) }()
	if err := EnqueueIncoming(ctx, firstTx, 303, firstDonationID, DonationAlertsSource, base); err != nil {
		t.Fatal(err)
	}
	secondTx, secondTxErr := pool.Begin(ctx)
	if secondTxErr != nil {
		t.Fatal(secondTxErr)
	}
	defer func() { _ = secondTx.Rollback(ctx) }()
	result := make(chan error, 1)
	go func() {
		result <- EnqueueIncoming(ctx, secondTx, 303, secondDonationID, DonationAlertsSource, base)
	}()
	select {
	case err := <-result:
		t.Fatalf("concurrent enqueue did not serialize: %v", err)
	case <-time.After(100 * time.Millisecond):
	}
	if err := firstTx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err := <-result; err != nil {
		t.Fatal(err)
	}
	if err := secondTx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	var pending int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM donation_alert_playback
		WHERE user_id = 303 AND status IN ('preparing', 'pending')
	`).Scan(&pending); err != nil {
		t.Fatal(err)
	}
	if pending != MaxPendingAlerts {
		t.Fatalf("pending backlog = %d, want %d", pending, MaxPendingAlerts)
	}
}

func TestSkipWaitsForLockedHeadInsteadOfSkippingLaterPlayback(t *testing.T) {
	store, pool := newAlertIntegrationStore(t)
	seedAlertUser(t, pool, 304)
	ctx := context.Background()
	base := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	first, firstErr := store.CreateTest(ctx, 304, base)
	if firstErr != nil {
		t.Fatal(firstErr)
	}
	second, secondErr := store.CreateTest(ctx, 304, base.Add(time.Millisecond))
	if secondErr != nil {
		t.Fatal(secondErr)
	}
	locker, lockerErr := pool.Begin(ctx)
	if lockerErr != nil {
		t.Fatal(lockerErr)
	}
	defer func() { _ = locker.Rollback(ctx) }()
	if _, err := locker.Exec(ctx, `
		SELECT 1 FROM donation_alert_playback
		WHERE donation_alert_playback_id = $1
		FOR UPDATE
	`, first.PlaybackID); err != nil {
		t.Fatal(err)
	}
	skipCtx, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
	defer cancel()
	if _, err := store.Skip(skipCtx, 304, base.Add(time.Second)); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("skip bypassed locked head: %v", err)
	}
	if err := locker.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	skipped, skipErr := store.Skip(ctx, 304, base.Add(time.Second))
	if skipErr != nil || skipped == nil || *skipped != first.PlaybackID {
		t.Fatalf("skipped=%v error=%v, want first=%s", skipped, skipErr, first.PlaybackID)
	}
	if status, err := store.PlaybackStatus(ctx, second.PlaybackID); err != nil || status != PendingStatus {
		t.Fatalf("second status=%q error=%v", status, err)
	}
}

func TestPollingAndClaimRecoverMissingFinishAcknowledgement(t *testing.T) {
	store, pool := newAlertIntegrationStore(t)
	ctx := context.Background()
	base := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)

	t.Run("stream polling", func(t *testing.T) {
		claimed := setupClaimedTestPlayback(t, ctx, store, pool, 400, base)
		startedAt := base.Add(time.Second)
		if err := store.StartPlayback(ctx, claimed.tokenHash, claimed.playerID, claimed.generation, claimed.playback.PlaybackID, startedAt); err != nil {
			t.Fatal(err)
		}
		keepPlayerAlive(t, ctx, store, claimed, base, startedAt.Add(PlaybackAcknowledgementTimeout-time.Second))
		paused, current, err := store.StreamState(ctx, claimed.tokenHash, claimed.playerID, claimed.generation, startedAt.Add(PlaybackAcknowledgementTimeout))
		if err != nil || paused || current != nil {
			t.Fatalf("stream state paused=%v current=%#v error=%v", paused, current, err)
		}
		stored := readPlaybackLifecycle(t, ctx, pool, claimed.playback.PlaybackID)
		if stored.status != InterruptedStatus || stored.detail == nil || *stored.detail != string(PlaybackTimeoutDiagnostic) {
			t.Fatalf("timed-out playback = %#v", stored)
		}
	})

	t.Run("claim next", func(t *testing.T) {
		claimed := setupClaimedTestPlayback(t, ctx, store, pool, 401, base)
		startedAt := base.Add(time.Second)
		if err := store.StartPlayback(ctx, claimed.tokenHash, claimed.playerID, claimed.generation, claimed.playback.PlaybackID, startedAt); err != nil {
			t.Fatal(err)
		}
		next, err := store.CreateTest(ctx, 401, base.Add(2*time.Second))
		if err != nil {
			t.Fatal(err)
		}
		keepPlayerAlive(t, ctx, store, claimed, base, startedAt.Add(PlaybackAcknowledgementTimeout-time.Second))
		got, err := store.ClaimPlayback(ctx, claimed.tokenHash, claimed.playerID, claimed.generation, startedAt.Add(PlaybackAcknowledgementTimeout))
		if err != nil || got == nil || got.PlaybackID != next.PlaybackID {
			t.Fatalf("recovery claim=%#v error=%v, want %s", got, err, next.PlaybackID)
		}
		stored := readPlaybackLifecycle(t, ctx, pool, claimed.playback.PlaybackID)
		if stored.status != InterruptedStatus || stored.detail == nil || *stored.detail != string(PlaybackTimeoutDiagnostic) {
			t.Fatalf("timed-out playback = %#v", stored)
		}
	})
}

func keepPlayerAlive(t *testing.T, ctx context.Context, store *Store, claimed claimedTestPlayback, from, until time.Time) {
	t.Helper()
	for heartbeatAt := from.Add(10 * time.Second); !heartbeatAt.After(until); heartbeatAt = heartbeatAt.Add(10 * time.Second) {
		if err := store.Heartbeat(ctx, claimed.tokenHash, claimed.playerID, claimed.generation, true, true, heartbeatAt); err != nil {
			t.Fatalf("heartbeat at %v: %v", heartbeatAt, err)
		}
	}
}

func TestFinishPlaybackIsConcurrentAndIdempotent(t *testing.T) {
	store, pool := newAlertIntegrationStore(t)
	ctx := context.Background()
	base := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	claimed := setupClaimedTestPlayback(t, ctx, store, pool, 500, base)
	if err := store.StartPlayback(ctx, claimed.tokenHash, claimed.playerID, claimed.generation, claimed.playback.PlaybackID, base.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	finishedAt := base.Add(2 * time.Second)
	errorsChannel := make(chan error, 2)
	start := make(chan struct{})
	var waitGroup sync.WaitGroup
	for range 2 {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			<-start
			errorsChannel <- store.FinishPlayback(ctx, claimed.tokenHash, claimed.playerID, claimed.generation, claimed.playback.PlaybackID, FinishCompleted, finishedAt)
		}()
	}
	close(start)
	waitGroup.Wait()
	close(errorsChannel)
	for err := range errorsChannel {
		if err != nil {
			t.Fatal(err)
		}
	}
	if err := store.FinishPlayback(ctx, claimed.tokenHash, claimed.playerID, claimed.generation, claimed.playback.PlaybackID, FinishCompleted, finishedAt.Add(time.Second)); err != nil {
		t.Fatalf("repeated completion: %v", err)
	}
	stored := readPlaybackLifecycle(t, ctx, pool, claimed.playback.PlaybackID)
	if stored.status != CompletedStatus || stored.finishedAt == nil || !stored.finishedAt.Equal(finishedAt) {
		t.Fatalf("completed playback = %#v", stored)
	}
	if err := store.FinishPlayback(ctx, claimed.tokenHash, claimed.playerID, claimed.generation, claimed.playback.PlaybackID, FinishInterrupted, finishedAt.Add(time.Second)); !errors.Is(err, ErrLeaseLost) {
		t.Fatalf("conflicting finish outcome = %v", err)
	}
}

func TestFinishCannotMakeUnacknowledgedPlaybackTerminal(t *testing.T) {
	store, pool := newAlertIntegrationStore(t)
	ctx := context.Background()
	base := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	claimed := setupClaimedTestPlayback(t, ctx, store, pool, 501, base)
	if err := store.FinishPlayback(ctx, claimed.tokenHash, claimed.playerID, claimed.generation, claimed.playback.PlaybackID, FinishCompleted, base.Add(time.Second)); !errors.Is(err, ErrLeaseLost) {
		t.Fatalf("unacknowledged completion = %v", err)
	}
	if err := store.FinishPlayback(ctx, claimed.tokenHash, claimed.playerID, claimed.generation, claimed.playback.PlaybackID, FinishInterrupted, base.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	stored := readPlaybackLifecycle(t, ctx, pool, claimed.playback.PlaybackID)
	if stored.status != PendingStatus || stored.startedAt != nil || stored.finishedAt != nil || stored.playerID != nil || stored.playerGeneration != nil {
		t.Fatalf("unacknowledged interruption became terminal: %#v", stored)
	}
}

func TestReplayRequiresDonationBackedTerminalPlayback(t *testing.T) {
	store, pool := newAlertIntegrationStore(t)
	seedAlertUser(t, pool, 600)
	ctx := context.Background()
	base := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	settings := DefaultSettings()
	settings.Enabled = true
	if _, err := store.UpdateSettings(ctx, 600, settings); err != nil {
		t.Fatal(err)
	}
	testPlayback, createErr := store.CreateTest(ctx, 600, base)
	if createErr != nil {
		t.Fatal(createErr)
	}
	if _, err := pool.Exec(ctx, `
		UPDATE donation_alert_playback SET status = 'completed', finished_at = $2
		WHERE donation_alert_playback_id = $1
	`, testPlayback.PlaybackID, base.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Replay(ctx, 600, testPlayback.PlaybackID, base.Add(2*time.Second)); !errors.Is(err, ErrNotFound) {
		t.Fatalf("replayed donation-less test: %v", err)
	}

	donationID := insertAlertDonation(t, pool, 600, "replay-source", base)
	tx, beginErr := pool.Begin(ctx)
	if beginErr != nil {
		t.Fatal(beginErr)
	}
	if err := EnqueueIncoming(ctx, tx, 600, donationID, DonationAlertsSource, base); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	var sourcePlaybackID string
	if err := pool.QueryRow(ctx, `
		SELECT donation_alert_playback_id::text
		FROM donation_alert_playback WHERE donation_id = $1 AND kind = 'incoming'
	`, donationID).Scan(&sourcePlaybackID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Replay(ctx, 600, sourcePlaybackID, base.Add(2*time.Second)); !errors.Is(err, ErrNotFound) {
		t.Fatalf("replayed nonterminal donation playback: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		UPDATE donation_alert_playback SET status = 'completed', finished_at = $2
		WHERE donation_alert_playback_id = $1
	`, sourcePlaybackID, base.Add(3*time.Second)); err != nil {
		t.Fatal(err)
	}
	replay, replayErr := store.Replay(ctx, 600, sourcePlaybackID, base.Add(4*time.Second))
	if replayErr != nil || replay == nil || replay.Kind != ReplayPlayback || replay.DonationID == nil || *replay.DonationID != donationID {
		t.Fatalf("terminal replay=%#v error=%v", replay, replayErr)
	}
}

func TestRendererDiagnosticIsGuardedAndStable(t *testing.T) {
	store, pool := newAlertIntegrationStore(t)
	ctx := context.Background()
	base := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	claimed := setupClaimedTestPlayback(t, ctx, store, pool, 700, base)
	if err := store.StartPlayback(ctx, claimed.tokenHash, claimed.playerID, claimed.generation, claimed.playback.PlaybackID, base.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordPlaybackDiagnostic(ctx, claimed.tokenHash, "c2723d6f-6d80-4abd-8456-b66bfc593a12", claimed.generation, claimed.playback.PlaybackID, ImageUnavailableDiagnostic, base.Add(2*time.Second)); !errors.Is(err, ErrLeaseLost) {
		t.Fatalf("wrong player diagnostic = %v", err)
	}
	if err := store.RecordPlaybackDiagnostic(ctx, claimed.tokenHash, claimed.playerID, claimed.generation, claimed.playback.PlaybackID, DiagnosticCode("private detail"), base.Add(2*time.Second)); err == nil {
		t.Fatal("arbitrary renderer diagnostic was accepted")
	}
	if err := store.RecordPlaybackDiagnostic(ctx, claimed.tokenHash, claimed.playerID, claimed.generation, claimed.playback.PlaybackID, ImageUnavailableDiagnostic, base.Add(2*time.Second)); err != nil {
		t.Fatal(err)
	}
	if status, err := store.PlaybackStatus(ctx, claimed.playback.PlaybackID); err != nil || status != PlayingStatus {
		t.Fatalf("diagnostic changed lifecycle: status=%q error=%v", status, err)
	}
	finishedAt := base.Add(3 * time.Second)
	if err := store.FinishPlayback(ctx, claimed.tokenHash, claimed.playerID, claimed.generation, claimed.playback.PlaybackID, FinishCompleted, finishedAt); err != nil {
		t.Fatal(err)
	}
	secondDiagnosticAt := base.Add(4 * time.Second)
	if err := store.RecordPlaybackDiagnostic(ctx, claimed.tokenHash, claimed.playerID, claimed.generation, claimed.playback.PlaybackID, SoundUnavailableDiagnostic, secondDiagnosticAt); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordPlaybackDiagnostic(ctx, claimed.tokenHash, claimed.playerID, claimed.generation, claimed.playback.PlaybackID, ImageUnavailableDiagnostic, base.Add(5*time.Second)); err != nil {
		t.Fatal(err)
	}
	dashboard, err := store.Dashboard(ctx, 700, base.Add(6*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if len(dashboard.Diagnostics) != 2 {
		t.Fatalf("diagnostics = %#v", dashboard.Diagnostics)
	}
	if dashboard.Diagnostics[0].Code != SoundUnavailableDiagnostic || !dashboard.Diagnostics[0].OccurredAt.Equal(secondDiagnosticAt) {
		t.Fatalf("latest diagnostic = %#v", dashboard.Diagnostics[0])
	}
	diagnostic := dashboard.Diagnostics[1]
	if diagnostic.Code != ImageUnavailableDiagnostic || diagnostic.Level != DiagnosticWarning || !diagnostic.OccurredAt.Equal(base.Add(2*time.Second)) {
		t.Fatalf("first diagnostic = %#v", diagnostic)
	}
	if diagnostic.Detail == string(ImageUnavailableDiagnostic) || diagnostic.Detail == "" {
		t.Fatalf("unstable diagnostic detail = %q", diagnostic.Detail)
	}
	var lastError *string
	if err := pool.QueryRow(ctx, `
		SELECT last_error
		FROM donation_alert_playback
		WHERE donation_alert_playback_id = $1
	`, claimed.playback.PlaybackID).Scan(&lastError); err != nil {
		t.Fatal(err)
	}
	if lastError != nil {
		t.Fatalf("renderer diagnostic overwrote lifecycle error: %q", *lastError)
	}
}

func TestTokenRotationAndHeartbeatUseConsistentLockOrder(t *testing.T) {
	store, pool := newAlertIntegrationStore(t)
	base := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	claimed := setupClaimedTestPlayback(t, ctx, store, pool, 800, base)
	if err := store.StartPlayback(ctx, claimed.tokenHash, claimed.playerID, claimed.generation, claimed.playback.PlaybackID, base.Add(time.Second)); err != nil {
		t.Fatal(err)
	}

	//nolint:gosec // The test-local schema sequence cannot approach the int64 limit.
	advisoryKey := int64(90_000_000 + alertTestSchemaSequence.Load())
	if _, err := pool.Exec(ctx, fmt.Sprintf(`
		CREATE FUNCTION alert_rotation_barrier() RETURNS trigger
		LANGUAGE plpgsql AS $function$
		BEGIN
			PERFORM pg_advisory_xact_lock(%d);
			RETURN NEW;
		END
		$function$;
		CREATE TRIGGER alert_rotation_barrier
		BEFORE UPDATE ON donation_alert_playback
		FOR EACH ROW EXECUTE FUNCTION alert_rotation_barrier()
	`, advisoryKey)); err != nil {
		t.Fatal(err)
	}
	blocker, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer blocker.Release()
	if _, err := blocker.Exec(ctx, `SELECT pg_advisory_lock($1)`, advisoryKey); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _ = blocker.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, advisoryKey)
	}()

	rotationDone := make(chan error, 1)
	go func() {
		rotationDone <- store.SetOverlayTokenHash(
			ctx,
			800,
			hashToken("rotation-lock-order-00000000000"),
			base.Add(2*time.Second),
		)
	}()
	waitForAlertLockWaiters(t, ctx, pool, 1)

	heartbeatDone := make(chan error, 1)
	go func() {
		heartbeatDone <- store.Heartbeat(
			ctx,
			claimed.tokenHash,
			claimed.playerID,
			claimed.generation,
			false,
			true,
			base.Add(2*time.Second),
		)
	}()
	waitForAlertLockWaiters(t, ctx, pool, 2)
	if _, err := blocker.Exec(ctx, `SELECT pg_advisory_unlock($1)`, advisoryKey); err != nil {
		t.Fatal(err)
	}

	if err := <-rotationDone; err != nil {
		t.Fatalf("rotate overlay token: %v", err)
	}
	if err := <-heartbeatDone; !errors.Is(err, ErrLeaseLost) {
		t.Fatalf("heartbeat error = %v, want %v", err, ErrLeaseLost)
	}
}

func TestAssetMutationsLockConfigurationBeforeAsset(t *testing.T) {
	store, pool := newAlertIntegrationStore(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	seedAlertUser(t, pool, 801)
	media := Media{MIMEType: "image/png", Content: []byte("same-validated-image")}
	asset, assetErr := store.SaveAsset(ctx, 801, ImageAsset, media, time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC))
	if assetErr != nil {
		t.Fatal(assetErr)
	}

	//nolint:gosec // The test-local schema sequence cannot approach the int64 limit.
	advisoryKey := int64(91_000_000 + alertTestSchemaSequence.Load())
	if _, err := pool.Exec(ctx, fmt.Sprintf(`
		CREATE FUNCTION alert_asset_barrier() RETURNS trigger
		LANGUAGE plpgsql AS $function$
		BEGIN
			PERFORM pg_advisory_xact_lock(%d);
			RETURN NEW;
		END
		$function$;
		CREATE TRIGGER alert_asset_barrier
		BEFORE UPDATE ON donation_alert_asset
		FOR EACH ROW EXECUTE FUNCTION alert_asset_barrier()
	`, advisoryKey)); err != nil {
		t.Fatal(err)
	}
	blocker, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer blocker.Release()
	if _, err := blocker.Exec(ctx, `SELECT pg_advisory_lock($1)`, advisoryKey); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _ = blocker.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, advisoryKey)
	}()

	uploadDone := make(chan error, 1)
	go func() {
		_, err := store.SaveAsset(ctx, 801, ImageAsset, media, time.Date(2026, 9, 13, 12, 0, 1, 0, time.UTC))
		uploadDone <- err
	}()
	waitForAlertLockWaiters(t, ctx, pool, 1)

	deleteDone := make(chan error, 1)
	go func() { deleteDone <- store.DeleteAsset(ctx, 801, asset.AssetID) }()
	waitForAlertLockWaiters(t, ctx, pool, 2)
	if _, err := blocker.Exec(ctx, `SELECT pg_advisory_unlock($1)`, advisoryKey); err != nil {
		t.Fatal(err)
	}

	if err := <-uploadDone; err != nil {
		t.Fatalf("re-upload asset: %v", err)
	}
	if err := <-deleteDone; err != nil {
		t.Fatalf("delete asset: %v", err)
	}
}

func waitForAlertLockWaiters(t *testing.T, ctx context.Context, pool *pgxpool.Pool, want int) {
	t.Helper()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		var count int
		if err := pool.QueryRow(ctx, `
			SELECT count(*)
			FROM pg_stat_activity
			WHERE datname = current_database()
				AND pid <> pg_backend_pid()
				AND wait_event_type = 'Lock'
				AND query LIKE '%donation_alert_%'
		`).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count >= want {
			return
		}
		select {
		case <-ctx.Done():
			t.Fatalf("alert lock waiters = %d, want at least %d: %v", count, want, ctx.Err())
		case <-ticker.C:
		}
	}
}

func insertAlertDonation(t *testing.T, pool *pgxpool.Pool, userID int, sourceDonationID string, occurredAt time.Time) int64 {
	t.Helper()
	var donationID int64
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO donation (
			source, source_donation_id, user_id, author, message,
			amount, currency, source_created_at, occurred_at
		)
		VALUES ('donationalerts', $1, $2, 'Donor', 'Message', 10, 'RUB', $3, $4)
		RETURNING donation_id
	`, sourceDonationID, userID, occurredAt.Format(time.RFC3339Nano), occurredAt).Scan(&donationID); err != nil {
		t.Fatal(err)
	}
	return donationID
}
