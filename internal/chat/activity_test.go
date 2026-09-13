package chat

import (
	"testing"
	"time"
)

func TestSummarizeActivityCountsUniqueUsersAcrossConsumers(t *testing.T) {
	now := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	live := []activityRecord{
		{UserID: 1, Consumer: ActivityConsumerMultichat, SeenAt: now},
		{UserID: 2, Consumer: ActivityConsumerMultichat, SeenAt: now},
		{UserID: 2, Consumer: ActivityConsumerOverlay, SeenAt: now},
	}
	seen := []activityRecord{
		{UserID: 1, Consumer: ActivityConsumerMultichat, SeenAt: now.Add(-time.Hour)},
		{UserID: 3, Consumer: ActivityConsumerMultichat, SeenAt: now.Add(-8 * 24 * time.Hour)},
		{UserID: 2, Consumer: ActivityConsumerOverlay, SeenAt: now.Add(-2 * 24 * time.Hour)},
	}

	snapshot := summarizeActivity(live, seen, now.Add(-20*24*time.Hour), now)

	if snapshot.Multichat != (ActivityPeriod{Now: 2, Day: 1, Week: 1, Month: 2}) {
		t.Fatalf("multichat = %+v", snapshot.Multichat)
	}
	if snapshot.Overlay != (ActivityPeriod{Now: 1, Day: 0, Week: 1, Month: 1}) {
		t.Fatalf("overlay = %+v", snapshot.Overlay)
	}
	if snapshot.Total != (ActivityPeriod{Now: 2, Day: 1, Week: 2, Month: 3}) {
		t.Fatalf("total = %+v", snapshot.Total)
	}
}
