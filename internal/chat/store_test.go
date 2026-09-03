package chat

import (
	"reflect"
	"testing"
)

func TestCapabilitiesFor(t *testing.T) {
	tests := []struct {
		name     string
		provider string
		scopes   []string
		expected []Capability
	}{
		{name: "youtube full", provider: "youtube", scopes: []string{"https://www.googleapis.com/auth/youtube.force-ssl"}, expected: []Capability{CapabilityRead, CapabilitySendMessage, CapabilityDeleteMessage, CapabilityTimeoutUser, CapabilityBanUser, CapabilityUnbanUser}},
		{name: "youtube read only", provider: "youtube", expected: []Capability{CapabilityRead}},
		{name: "twitch partial", provider: "twitch", scopes: []string{"user:read:chat", "moderator:manage:banned_users"}, expected: []Capability{CapabilityRead, CapabilityTimeoutUser, CapabilityBanUser, CapabilityUnbanUser}},
		{name: "kick full", provider: "kick", scopes: []string{"events:subscribe", "chat:write", "moderation:chat_message:manage", "moderation:ban"}, expected: []Capability{CapabilityRead, CapabilitySendMessage, CapabilityDeleteMessage, CapabilityTimeoutUser, CapabilityBanUser, CapabilityUnbanUser}},
		{name: "boosty release gated", provider: "boosty", expected: []Capability{CapabilityRead}},
		{name: "vk video release gated", provider: "vk_video", expected: []Capability{CapabilityRead}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if actual := CapabilitiesFor(test.provider, test.scopes); !reflect.DeepEqual(actual, test.expected) {
				t.Fatalf("CapabilitiesFor() = %v; want %v", actual, test.expected)
			}
		})
	}
}
