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
	namespaceID := uint32(time.Now().UnixNano() & 0xffff_ffff)
	namespace := fmt.Sprintf("wt_%08x", namespaceID)
	connection, connectErr := ConnectNats(server, namespace)
	if connectErr != nil {
		t.Fatal(connectErr)
	}
	defer func() { _ = connection.Close() }()
	defer func() {
		if deleteErr := DeleteNatsNamespace(server, namespace); deleteErr != nil {
			t.Error(deleteErr)
		}
	}()
	otherNamespace := fmt.Sprintf("wt_%08x", namespaceID+1)
	otherConnection, otherConnectErr := ConnectNats(server, otherNamespace)
	if otherConnectErr != nil {
		t.Fatal(otherConnectErr)
	}
	defer func() { _ = otherConnection.Close() }()
	defer func() {
		if deleteErr := DeleteNatsNamespace(server, otherNamespace); deleteErr != nil {
			t.Error(deleteErr)
		}
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	userID := int(time.Now().UnixNano()%1_000_000_000) + 1
	sourceID := "00000000-0000-4000-8000-" + fmt.Sprintf("%012x", time.Now().UnixNano()&0xffffffffffff)
	events := connection.Broker.Stream(ctx, userID)
	otherEvents := otherConnection.Broker.Stream(ctx, userID)
	message := Message{ID: "message-1", SourceID: sourceID, ConnectionID: "00000000-0000-4000-8000-000000000001", Provider: "youtube", Author: Author{ID: "viewer-1", DisplayName: "Viewer"}, Text: "hello", OccurredAt: time.Now().UTC()}
	if publishErr := connection.Broker.Publish(ctx, userID, StreamEvent{Type: "message", Message: &message}, "integration:"+sourceID); publishErr != nil {
		t.Fatal(publishErr)
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
	if _, publishErr := connection.Broker.jetstream.Publish(connection.Broker.userSubject(userID), invalidPayload); publishErr != nil {
		t.Fatal(publishErr)
	}
	var deadLetters DeadLetterPage
	for deadLetters.Total == 0 {
		var listErr error
		deadLetters, listErr = connection.DeadLetters.List(ctx, 25, 0)
		if listErr != nil {
			t.Fatal(listErr)
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

	lease, acquireErr := connection.Leases.Acquire(ctx, sourceID, "owner-1")
	if acquireErr != nil || lease == nil {
		t.Fatalf("first lease = %v, %v", lease, acquireErr)
	}
	contended, contendErr := connection.Leases.Acquire(ctx, sourceID, "owner-2")
	if contendErr != nil || contended != nil {
		t.Fatalf("contended lease = %v, %v", contended, contendErr)
	}
	if releaseErr := lease.Release(); releaseErr != nil {
		t.Fatal(releaseErr)
	}
	reacquired, reacquireErr := connection.Leases.Acquire(ctx, sourceID, "owner-2")
	if reacquireErr != nil || reacquired == nil {
		t.Fatalf("reacquired lease = %v, %v", reacquired, reacquireErr)
	}
	if releaseErr := reacquired.Release(); releaseErr != nil {
		t.Fatal(releaseErr)
	}

	if deleteErr := DeleteOtherWorktreeNatsNamespaces(server, namespace); deleteErr != nil {
		t.Fatal(deleteErr)
	}
	resources, resourcesErr := resourcesForNamespace(namespace)
	if resourcesErr != nil {
		t.Fatal(resourcesErr)
	}
	if _, streamInfoErr := connection.Broker.jetstream.StreamInfo(resources.stream); streamInfoErr != nil {
		t.Fatalf("primary test namespace was deleted: %v", streamInfoErr)
	}
	otherResources, otherResourcesErr := resourcesForNamespace(otherNamespace)
	if otherResourcesErr != nil {
		t.Fatal(otherResourcesErr)
	}
	if _, streamInfoErr := connection.Broker.jetstream.StreamInfo(otherResources.stream); !errors.Is(streamInfoErr, nats.ErrStreamNotFound) {
		t.Fatalf("secondary test namespace still exists: %v", streamInfoErr)
	}
}
