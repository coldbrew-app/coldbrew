package chat

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/nats-io/nats.go"
)

const (
	chatActivityHeartbeat = 15 * time.Second
	chatActivityLiveTTL   = 45 * time.Second
	chatActivitySeenTTL   = 31 * 24 * time.Hour
	activityTrackingKey   = "tracking.start"
)

type ActivityConsumer string

const (
	ActivityConsumerMultichat ActivityConsumer = "multichat"
	ActivityConsumerOverlay   ActivityConsumer = "overlay"
)

func parseActivityConsumer(value string) (ActivityConsumer, bool) {
	consumer := ActivityConsumer(value)
	return consumer, consumer == ActivityConsumerMultichat || consumer == ActivityConsumerOverlay
}

type ActivityPeriod struct {
	Now   int `json:"now"`
	Day   int `json:"day"`
	Week  int `json:"week"`
	Month int `json:"month"`
}

type ActivitySnapshot struct {
	TrackingSince time.Time      `json:"trackingSince"`
	Multichat     ActivityPeriod `json:"multichat"`
	Overlay       ActivityPeriod `json:"overlay"`
	Total         ActivityPeriod `json:"total"`
}

type ActivityTracker interface {
	Track(context.Context, int, ActivityConsumer)
	Snapshot(context.Context) (ActivitySnapshot, error)
}

type NatsActivityTracker struct {
	live nats.KeyValue
	seen nats.KeyValue
	now  func() time.Time
}

func NewNatsActivityTracker(live, seen nats.KeyValue) *NatsActivityTracker {
	return &NatsActivityTracker{live: live, seen: seen, now: time.Now}
}

type activityRecord struct {
	UserID   int              `json:"userId"`
	Consumer ActivityConsumer `json:"consumer"`
	SeenAt   time.Time        `json:"seenAt"`
}

type trackingStart struct {
	StartedAt time.Time `json:"startedAt"`
}

func (tracker *NatsActivityTracker) Track(ctx context.Context, userID int, consumer ActivityConsumer) {
	connectionID, err := randomActivityConnectionID()
	if err != nil {
		slog.Warn("Create chat activity connection id", "error", err)
		return
	}
	liveKey := fmt.Sprintf("%s.%s", consumer, connectionID)
	seenKey := fmt.Sprintf("%s.%d", consumer, userID)
	record := func() {
		seenAt := tracker.now().UTC()
		value, marshalErr := json.Marshal(activityRecord{UserID: userID, Consumer: consumer, SeenAt: seenAt})
		if marshalErr != nil {
			slog.Warn("Encode chat activity", "error", marshalErr)
			return
		}
		if trackingErr := tracker.touchTrackingStart(seenAt); trackingErr != nil {
			slog.Warn("Record chat activity coverage", "error", trackingErr)
		}
		if _, putErr := tracker.live.Put(liveKey, value); putErr != nil {
			slog.Warn("Record live chat activity", "error", putErr)
		}
		if _, putErr := tracker.seen.Put(seenKey, value); putErr != nil {
			slog.Warn("Record historical chat activity", "error", putErr)
		}
	}

	record()
	ticker := time.NewTicker(chatActivityHeartbeat)
	defer ticker.Stop()
	defer func() {
		if deleteErr := tracker.live.Delete(liveKey); deleteErr != nil && !errors.Is(deleteErr, nats.ErrKeyNotFound) {
			slog.Warn("Remove live chat activity", "error", deleteErr)
		}
	}()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			record()
		}
	}
}

func (tracker *NatsActivityTracker) touchTrackingStart(now time.Time) error {
	value := trackingStart{StartedAt: now}
	entry, err := tracker.seen.Get(activityTrackingKey)
	if err == nil {
		if unmarshalErr := json.Unmarshal(entry.Value(), &value); unmarshalErr != nil {
			return unmarshalErr
		}
	} else if !errors.Is(err, nats.ErrKeyNotFound) {
		return err
	}
	body, err := json.Marshal(value)
	if err != nil {
		return err
	}
	_, err = tracker.seen.Put(activityTrackingKey, body)
	return err
}

func (tracker *NatsActivityTracker) Snapshot(ctx context.Context) (ActivitySnapshot, error) {
	now := tracker.now().UTC()
	live, err := readActivityRecords(ctx, tracker.live)
	if err != nil {
		return ActivitySnapshot{}, err
	}
	seen, err := readActivityRecords(ctx, tracker.seen)
	if err != nil {
		return ActivitySnapshot{}, err
	}
	trackingSince := now
	entry, trackingErr := tracker.seen.Get(activityTrackingKey)
	if trackingErr == nil {
		var start trackingStart
		if unmarshalErr := json.Unmarshal(entry.Value(), &start); unmarshalErr == nil && !start.StartedAt.IsZero() {
			trackingSince = start.StartedAt
		}
	} else if !errors.Is(trackingErr, nats.ErrKeyNotFound) {
		return ActivitySnapshot{}, trackingErr
	}
	return summarizeActivity(live, seen, trackingSince, now), nil
}

func readActivityRecords(ctx context.Context, bucket nats.KeyValue) ([]activityRecord, error) {
	keys, err := bucket.Keys(nats.Context(ctx))
	if errors.Is(err, nats.ErrNoKeysFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	records := make([]activityRecord, 0, len(keys))
	for _, key := range keys {
		if key == activityTrackingKey {
			continue
		}
		entry, getErr := bucket.Get(key)
		if errors.Is(getErr, nats.ErrKeyNotFound) {
			continue
		}
		if getErr != nil {
			return nil, getErr
		}
		var record activityRecord
		if unmarshalErr := json.Unmarshal(entry.Value(), &record); unmarshalErr != nil || record.UserID <= 0 {
			continue
		}
		if _, valid := parseActivityConsumer(string(record.Consumer)); !valid || record.SeenAt.IsZero() {
			continue
		}
		records = append(records, record)
	}
	return records, nil
}

func summarizeActivity(live, seen []activityRecord, trackingSince, now time.Time) ActivitySnapshot {
	liveUsers := map[ActivityConsumer]map[int]struct{}{
		ActivityConsumerMultichat: {},
		ActivityConsumerOverlay:   {},
	}
	seenUsers := map[ActivityConsumer]map[int]time.Time{
		ActivityConsumerMultichat: {},
		ActivityConsumerOverlay:   {},
	}
	for _, record := range live {
		liveUsers[record.Consumer][record.UserID] = struct{}{}
	}
	for _, record := range seen {
		previous, exists := seenUsers[record.Consumer][record.UserID]
		if !exists || record.SeenAt.After(previous) {
			seenUsers[record.Consumer][record.UserID] = record.SeenAt
		}
	}
	return ActivitySnapshot{
		TrackingSince: trackingSince,
		Multichat:     activityPeriod(liveUsers, seenUsers, []ActivityConsumer{ActivityConsumerMultichat}, now),
		Overlay:       activityPeriod(liveUsers, seenUsers, []ActivityConsumer{ActivityConsumerOverlay}, now),
		Total:         activityPeriod(liveUsers, seenUsers, []ActivityConsumer{ActivityConsumerMultichat, ActivityConsumerOverlay}, now),
	}
}

func activityPeriod(live map[ActivityConsumer]map[int]struct{}, seen map[ActivityConsumer]map[int]time.Time, consumers []ActivityConsumer, now time.Time) ActivityPeriod {
	nowUsers := make(map[int]struct{})
	lastSeen := make(map[int]time.Time)
	for _, consumer := range consumers {
		for userID := range live[consumer] {
			nowUsers[userID] = struct{}{}
		}
		for userID, seenAt := range seen[consumer] {
			if previous, exists := lastSeen[userID]; !exists || seenAt.After(previous) {
				lastSeen[userID] = seenAt
			}
		}
	}
	period := ActivityPeriod{Now: len(nowUsers)}
	for _, seenAt := range lastSeen {
		since := now.Sub(seenAt)
		if since <= 24*time.Hour {
			period.Day++
		}
		if since <= 7*24*time.Hour {
			period.Week++
		}
		if since <= 30*24*time.Hour {
			period.Month++
		}
	}
	return period
}

func randomActivityConnectionID() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return hex.EncodeToString(value), nil
}
