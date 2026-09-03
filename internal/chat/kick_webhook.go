package chat

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

const kickWebhookClockSkew = 5 * time.Minute

type KickWebhookError struct {
	Type   string
	Detail string
	Cause  error
}

func (e *KickWebhookError) Error() string { return e.Detail }
func (e *KickWebhookError) Unwrap() error { return e.Cause }

type KickSourceStore interface {
	GetEnabledSourceByProviderID(context.Context, string, string) (*OwnedConnectedSource, error)
}

type KickWebhookHandler struct {
	publicKey *rsa.PublicKey
	store     KickSourceStore
	broker    EventBroker
	now       func() time.Time
}

func NewKickWebhookHandler(publicKey string, store KickSourceStore, broker EventBroker) (*KickWebhookHandler, error) {
	block, _ := pem.Decode([]byte(strings.ReplaceAll(publicKey, `\n`, "\n")))
	if block == nil {
		return nil, errors.New("invalid Kick webhook public key")
	}
	parsed, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		if pkcs1, pkcs1Err := x509.ParsePKCS1PublicKey(block.Bytes); pkcs1Err == nil {
			return &KickWebhookHandler{publicKey: pkcs1, store: store, broker: broker, now: time.Now}, nil
		}
		return nil, err
	}
	key, ok := parsed.(*rsa.PublicKey)
	if !ok {
		return nil, errors.New("Kick webhook public key is not RSA")
	}
	return &KickWebhookHandler{publicKey: key, store: store, broker: broker, now: time.Now}, nil
}

func (handler *KickWebhookHandler) Handle(ctx context.Context, headers http.Header, body string) error {
	messageID, err := requiredKickHeader(headers, "Kick-Event-Message-Id")
	if err != nil {
		return err
	}
	timestamp, err := requiredKickHeader(headers, "Kick-Event-Message-Timestamp")
	if err != nil {
		return err
	}
	signature, err := requiredKickHeader(headers, "Kick-Event-Signature")
	if err != nil {
		return err
	}
	eventType, err := requiredKickHeader(headers, "Kick-Event-Type")
	if err != nil {
		return err
	}
	if err := handler.verify(messageID, timestamp, body, signature); err != nil {
		return err
	}
	if eventType != "chat.message.sent" {
		return nil
	}
	var message struct {
		MessageID   string `json:"message_id"`
		Broadcaster struct {
			UserID   stringOrNumber `json:"user_id"`
			Username string         `json:"username"`
		} `json:"broadcaster"`
		Sender struct {
			UserID   stringOrNumber `json:"user_id"`
			Username string         `json:"username"`
		} `json:"sender"`
		Content   string `json:"content"`
		CreatedAt string `json:"created_at"`
	}
	if err := json.Unmarshal([]byte(body), &message); err != nil || message.MessageID == "" || message.Broadcaster.UserID == "" || message.Broadcaster.Username == "" || message.Sender.UserID == "" || message.Sender.Username == "" {
		return &KickWebhookError{Type: "invalid kick webhook", Detail: "Kick message payload is invalid", Cause: err}
	}
	occurredAt, err := time.Parse(time.RFC3339Nano, message.CreatedAt)
	if err != nil {
		return &KickWebhookError{Type: "invalid kick webhook", Detail: "Kick message payload is invalid", Cause: err}
	}
	source, err := handler.store.GetEnabledSourceByProviderID(ctx, "kick", string(message.Broadcaster.UserID))
	if err != nil {
		return err
	}
	if source == nil {
		return &KickWebhookError{Type: "unknown kick source", Detail: "Kick source not found"}
	}
	normalized := Message{ID: message.MessageID, SourceID: source.ConnectedSource.Source.SourceID, ConnectionID: source.ConnectedSource.Source.ConnectionID, Provider: "kick", Author: Author{ID: string(message.Sender.UserID), DisplayName: message.Sender.Username}, Text: message.Content, OccurredAt: occurredAt}
	return handler.broker.Publish(ctx, source.UserID, StreamEvent{Type: "message", Message: &normalized}, "kick:"+messageID)
}

func (handler *KickWebhookHandler) verify(messageID, timestamp, body, signature string) error {
	occurredAt, err := time.Parse(time.RFC3339Nano, timestamp)
	if err != nil || handler.now().Sub(occurredAt).Abs() > kickWebhookClockSkew {
		return &KickWebhookError{Type: "invalid kick webhook", Detail: "Kick webhook timestamp is stale", Cause: err}
	}
	decoded, err := base64.StdEncoding.DecodeString(signature)
	if err != nil {
		return &KickWebhookError{Type: "invalid kick webhook", Detail: "Kick webhook signature is invalid", Cause: err}
	}
	digest := sha256.Sum256([]byte(messageID + "." + timestamp + "." + body))
	if err := rsa.VerifyPKCS1v15(handler.publicKey, crypto.SHA256, digest[:], decoded); err != nil {
		return &KickWebhookError{Type: "invalid kick webhook", Detail: "Kick webhook signature is invalid", Cause: err}
	}
	return nil
}

func requiredKickHeader(headers http.Header, name string) (string, error) {
	value := headers.Get(name)
	if value == "" {
		return "", &KickWebhookError{Type: "invalid kick webhook", Detail: fmt.Sprintf("%s is missing", name)}
	}
	return value, nil
}
