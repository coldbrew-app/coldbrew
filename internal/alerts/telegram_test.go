package alerts

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/lebedev-nikita/coldbrew/internal/observability"
)

func TestTruncateUsesTelegramCharacterLimit(t *testing.T) {
	value := strings.Repeat("я", telegramMessageLimit+100)
	result := truncate(value, telegramMessageLimit)
	if got := utf8.RuneCountInString(result); got != telegramMessageLimit {
		t.Fatalf("length = %d", got)
	}
}

func TestSendFormatsEventForConfiguredChat(t *testing.T) {
	var requestBody struct {
		ChatID string `json:"chat_id"`
		Text   string `json:"text"`
	}
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/bottest-token/sendMessage" {
			t.Errorf("path = %q", request.URL.Path)
		}
		if err := json.NewDecoder(request.Body).Decode(&requestBody); err != nil {
			t.Error(err)
		}
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()
	telegram := NewTelegram("test-token", "-100123", server.Client())
	telegram.baseURL = server.URL
	err := telegram.Send(context.Background(), observability.Event{
		OccurredAt: time.Date(2026, time.September, 9, 12, 0, 0, 0, time.UTC),
		Level:      "error", Service: "video", Environment: "production", Message: "worker failed",
	})
	if err != nil {
		t.Fatal(err)
	}
	if requestBody.ChatID != "-100123" || !strings.Contains(requestBody.Text, "ERROR · video · production") {
		t.Fatalf("request = %#v", requestBody)
	}
}

func TestRunCommandsRepliesWithChatID(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var reply struct {
		ChatID string `json:"chat_id"`
		Text   string `json:"text"`
	}
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case "/bottest-token/getMe":
			_, _ = response.Write([]byte(`{"ok":true,"result":{"username":"coldbrew_bot"}}`))
		case "/bottest-token/getUpdates":
			_, _ = response.Write([]byte(`{"ok":true,"result":[{"update_id":7,"message":{"text":"/myid@coldbrew_bot","chat":{"id":-100123}}}]}`))
		case "/bottest-token/sendMessage":
			if err := json.NewDecoder(request.Body).Decode(&reply); err != nil {
				t.Error(err)
			}
			_, _ = response.Write([]byte(`{"ok":true,"result":{}}`))
			cancel()
		default:
			t.Errorf("unexpected path %q", request.URL.Path)
		}
	}))
	defer server.Close()
	telegram := NewTelegram("test-token", "", server.Client())
	telegram.baseURL = server.URL
	if err := telegram.RunCommands(ctx); err != nil {
		t.Fatal(err)
	}
	if reply.ChatID != "-100123" || reply.Text != "-100123" {
		t.Fatalf("reply = %#v", reply)
	}
}
