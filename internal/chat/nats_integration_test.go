package chat

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"
)

func TestNatsBrokerAndLeasesIntegration(t *testing.T) {
	server := os.Getenv("NATS_TEST_URL")
	if server == "" {
		t.Skip("NATS_TEST_URL is not set")
	}
	connection, err := ConnectNats(server)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	userID := int(time.Now().UnixNano()%1_000_000_000) + 1
	sourceID := "00000000-0000-4000-8000-" + fmt.Sprintf("%012x", time.Now().UnixNano()&0xffffffffffff)
	events := connection.Broker.Stream(ctx, userID)
	message := Message{ID: "message-1", SourceID: sourceID, ConnectionID: "connection-1", Provider: "youtube", Author: Author{ID: "viewer-1", DisplayName: "Viewer"}, Text: "hello", OccurredAt: time.Now().UTC()}
	if err := connection.Broker.Publish(ctx, userID, StreamEvent{Type: "message", Message: &message}, "integration:"+sourceID); err != nil {
		t.Fatal(err)
	}
	select {
	case event := <-events:
		if event.Type != "message" || event.Message == nil || event.Message.Text != "hello" {
			t.Fatalf("unexpected event: %#v", event)
		}
	case <-ctx.Done():
		t.Fatal("timed out waiting for NATS event")
	}

	stateStream := connection.Broker.Stream(ctx, userID)
	select {
	case event := <-stateStream:
		if event.Type != "state" || event.SourceID != sourceID || event.State != "live" {
			t.Fatalf("unexpected cached state: %#v", event)
		}
	case <-ctx.Done():
		t.Fatal("timed out waiting for cached source state")
	}

	lease, err := connection.Leases.Acquire(ctx, sourceID, "owner-1")
	if err != nil || lease == nil {
		t.Fatalf("first lease = %v, %v", lease, err)
	}
	contended, err := connection.Leases.Acquire(ctx, sourceID, "owner-2")
	if err != nil || contended != nil {
		t.Fatalf("contended lease = %v, %v", contended, err)
	}
	if err := lease.Release(); err != nil {
		t.Fatal(err)
	}
	reacquired, err := connection.Leases.Acquire(ctx, sourceID, "owner-2")
	if err != nil || reacquired == nil {
		t.Fatalf("reacquired lease = %v, %v", reacquired, err)
	}
	if err := reacquired.Release(); err != nil {
		t.Fatal(err)
	}
}
