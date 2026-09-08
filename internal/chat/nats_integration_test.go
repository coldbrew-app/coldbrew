package chat

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/nats-io/nats.go"
)

func TestNatsBrokerAndLeasesIntegration(t *testing.T) {
	server := os.Getenv("NATS_TEST_URL")
	if server == "" {
		t.Skip("NATS_TEST_URL is not set")
	}
	namespaceID := uint32(time.Now().UnixNano())
	namespace := fmt.Sprintf("wt_%08x", namespaceID)
	connection, err := ConnectNats(server, namespace)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	defer func() {
		if err := DeleteNatsNamespace(server, namespace); err != nil {
			t.Error(err)
		}
	}()
	otherNamespace := fmt.Sprintf("wt_%08x", namespaceID+1)
	otherConnection, err := ConnectNats(server, otherNamespace)
	if err != nil {
		t.Fatal(err)
	}
	defer otherConnection.Close()
	defer func() {
		if err := DeleteNatsNamespace(server, otherNamespace); err != nil {
			t.Error(err)
		}
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	userID := int(time.Now().UnixNano()%1_000_000_000) + 1
	sourceID := "00000000-0000-4000-8000-" + fmt.Sprintf("%012x", time.Now().UnixNano()&0xffffffffffff)
	events := connection.Broker.Stream(ctx, userID)
	otherEvents := otherConnection.Broker.Stream(ctx, userID)
	message := Message{ID: "message-1", SourceID: sourceID, ConnectionID: "00000000-0000-4000-8000-000000000001", Provider: "youtube", Author: Author{ID: "viewer-1", DisplayName: "Viewer"}, Text: "hello", OccurredAt: time.Now().UTC()}
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
	select {
	case event := <-otherEvents:
		t.Fatalf("event crossed NATS namespace boundary: %#v", event)
	case <-time.After(100 * time.Millisecond):
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

	invalidPayload := []byte(`{"type":`)
	if _, err := connection.Broker.jetstream.Publish(connection.Broker.userSubject(userID), invalidPayload); err != nil {
		t.Fatal(err)
	}
	var deadLetters DeadLetterPage
	for deadLetters.Total == 0 {
		deadLetters, err = connection.DeadLetters.List(ctx, 25, 0)
		if err != nil {
			t.Fatal(err)
		}
		if deadLetters.Total == 0 {
			select {
			case <-ctx.Done():
				t.Fatal("timed out waiting for NATS dead letter")
			case <-time.After(10 * time.Millisecond):
			}
		}
	}
	if deadLetters.Total != 1 || len(deadLetters.Items) != 1 || string(deadLetters.Items[0].Payload) != string(invalidPayload) || deadLetters.Items[0].SourceSubject != connection.Broker.userSubject(userID) {
		t.Fatalf("unexpected dead letters: %#v", deadLetters)
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

	if err := DeleteOtherWorktreeNatsNamespaces(server, namespace); err != nil {
		t.Fatal(err)
	}
	resources, err := resourcesForNamespace(namespace)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := connection.Broker.jetstream.StreamInfo(resources.stream); err != nil {
		t.Fatalf("primary test namespace was deleted: %v", err)
	}
	otherResources, err := resourcesForNamespace(otherNamespace)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := connection.Broker.jetstream.StreamInfo(otherResources.stream); !errors.Is(err, nats.ErrStreamNotFound) {
		t.Fatalf("secondary test namespace still exists: %v", err)
	}
}
