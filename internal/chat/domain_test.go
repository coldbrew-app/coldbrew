package chat

import (
	"reflect"
	"testing"
)

func TestChatDomainProviders(t *testing.T) {
	expected := []string{"youtube", "twitch", "kick", "boosty", "vk_video"}
	if !reflect.DeepEqual(Providers, expected) {
		t.Fatalf("Providers = %v; want %v", Providers, expected)
	}
}

func TestChatDomainKeysMessagesWithinSource(t *testing.T) {
	sourceID := "019c58be-a09e-7000-8000-000000000001"
	if SourceKey(Source{SourceID: sourceID}) != sourceID || MessageKey(Message{SourceID: sourceID, ID: "message-1"}) != sourceID+":message-1" {
		t.Fatal("unexpected canonical chat key")
	}
}

func TestChatDomainRejectsTimeoutLongerThanTwoWeeks(t *testing.T) {
	command := ModerationCommand{Type: "timeout_user", SourceID: "019c58be-a09e-7000-8000-000000000001", ProviderUserID: "viewer-1", DurationSeconds: 1_209_601}
	if err := command.Validate(); err == nil {
		t.Fatal("expected timeout longer than two weeks to be rejected")
	}
}

func TestChatDomainRejectsMalformedSourceAndOversizedProviderUser(t *testing.T) {
	commands := []ModerationCommand{
		{Type: "delete_message", SourceID: "not-a-uuid", MessageID: "message-1"},
		{Type: "ban_user", SourceID: "019c58be-a09e-7000-8000-000000000001", ProviderUserID: string(make([]byte, 201))},
	}
	for _, command := range commands {
		if err := command.Validate(); err == nil {
			t.Fatalf("accepted invalid command: %#v", command)
		}
	}
}
