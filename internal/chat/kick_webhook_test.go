package chat

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"net/http"
	"testing"
	"time"
)

type kickTestStore struct{ source *OwnedConnectedSource }

func (store *kickTestStore) GetEnabledSourceByProviderID(context.Context, string, string) (*OwnedConnectedSource, error) {
	return store.source, nil
}

type kickTestBroker struct {
	userID int
	event  StreamEvent
	key    string
}

func (broker *kickTestBroker) Publish(_ context.Context, userID int, event StreamEvent, key string) error {
	broker.userID, broker.event, broker.key = userID, event, key
	return nil
}
func (*kickTestBroker) Stream(context.Context, int) <-chan StreamEvent {
	result := make(chan StreamEvent)
	close(result)
	return result
}

func TestKickWebhookVerifiesAndPublishes(t *testing.T) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	publicDER, err := x509.MarshalPKIXPublicKey(&privateKey.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	publicPEM := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: publicDER})
	store := &kickTestStore{source: &OwnedConnectedSource{UserID: 42, ConnectedSource: connectedSource(youtubeSourceID, "kick", CapabilityRead)}}
	store.source.ConnectedSource.Source.ConnectionID = "connection-id"
	broker := &kickTestBroker{}
	handler, err := NewKickWebhookHandler(string(publicPEM), store, broker)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	handler.now = func() time.Time { return now }
	body := `{"message_id":"provider-message","broadcaster":{"user_id":123,"username":"streamer"},"sender":{"user_id":"viewer-1","username":"Viewer"},"content":"hello","created_at":"2026-09-03T12:00:00Z"}`
	messageID, timestamp := "event-message-id", now.Format(time.RFC3339)
	digest := sha256.Sum256([]byte(messageID + "." + timestamp + "." + body))
	signature, err := rsa.SignPKCS1v15(rand.Reader, privateKey, crypto.SHA256, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	headers := http.Header{"Kick-Event-Message-Id": {messageID}, "Kick-Event-Message-Timestamp": {timestamp}, "Kick-Event-Signature": {base64.StdEncoding.EncodeToString(signature)}, "Kick-Event-Type": {"chat.message.sent"}}
	if err := handler.Handle(context.Background(), headers, body); err != nil {
		t.Fatal(err)
	}
	if broker.userID != 42 || broker.key != "kick:event-message-id" || broker.event.Message == nil || broker.event.Message.Author.ID != "viewer-1" || broker.event.Message.Text != "hello" {
		t.Fatalf("unexpected publication: user=%d key=%q event=%#v", broker.userID, broker.key, broker.event)
	}
}

func TestKickWebhookRejectsStaleTimestamp(t *testing.T) {
	privateKey, _ := rsa.GenerateKey(rand.Reader, 2048)
	publicDER, _ := x509.MarshalPKIXPublicKey(&privateKey.PublicKey)
	handler, err := NewKickWebhookHandler(string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: publicDER})), &kickTestStore{}, &kickTestBroker{})
	if err != nil {
		t.Fatal(err)
	}
	handler.now = func() time.Time { return time.Date(2026, 9, 3, 12, 10, 0, 0, time.UTC) }
	headers := http.Header{"Kick-Event-Message-Id": {"id"}, "Kick-Event-Message-Timestamp": {"2026-09-03T12:00:00Z"}, "Kick-Event-Signature": {"invalid"}, "Kick-Event-Type": {"chat.message.sent"}}
	if err := handler.Handle(context.Background(), headers, `{}`); err == nil {
		t.Fatal("expected stale webhook to be rejected")
	}
}
