package chat

import (
	"context"
	"os"
	"reflect"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestStoreReadsNullableDeviceID(t *testing.T) {
	databaseURL := os.Getenv("CHAT_STORE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("CHAT_STORE_TEST_DATABASE_URL is required for PostgreSQL integration tests")
	}
	ctx := context.Background()
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	config.MaxConns = 1 // Keep temporary tables on the same PostgreSQL session.
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	_, err = pool.Exec(ctx, `
		CREATE TEMP TABLE chat_provider_connection (
			chat_provider_connection_id uuid, user_id integer, status text,
			access_token_ciphertext bytea, refresh_token_ciphertext bytea,
			oauth_device_id text, access_token_expires_at timestamptz,
			scopes text[], token_version integer
		);
		CREATE TEMP TABLE chat_source (
			chat_source_id uuid, chat_provider_connection_id uuid, user_id integer,
			provider text, provider_source_id text, display_name text, source_url text,
			position integer, enabled boolean
		);
		INSERT INTO chat_provider_connection
		VALUES ('00000000-0000-0000-0000-000000000001', 1, 'connected', NULL, NULL, NULL, NULL, '{}', 1);
		INSERT INTO chat_source
		VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001',
			1, 'youtube', 'channel', 'Channel', 'https://youtube.com/channel/channel', 0, true);
	`)
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(pool, nil)
	for _, deviceID := range []string{"", "vk-device"} {
		t.Run("device="+deviceID, func(t *testing.T) {
			_, err := pool.Exec(ctx, "UPDATE pg_temp.chat_provider_connection SET oauth_device_id = NULLIF($1, '')", deviceID)
			if err != nil {
				t.Fatal(err)
			}
			all, err := store.GetAllEnabledSources(ctx)
			if err != nil {
				t.Fatal(err)
			}
			if len(all) != 1 || all[0].ConnectedSource.Credentials.DeviceID != deviceID {
				t.Fatalf("GetAllEnabledSources() = %#v", all)
			}
			sources, err := store.GetEnabledSources(ctx, 1)
			if err != nil {
				t.Fatal(err)
			}
			if len(sources) != 1 || sources[0].Credentials.DeviceID != deviceID {
				t.Fatalf("GetEnabledSources() = %#v", sources)
			}
			source, err := store.GetEnabledSourceByProviderID(ctx, "youtube", "channel")
			if err != nil {
				t.Fatal(err)
			}
			if source == nil || source.ConnectedSource.Credentials.DeviceID != deviceID {
				t.Fatalf("GetEnabledSourceByProviderID() = %#v", source)
			}
		})
	}
}

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
		{name: "vk video read only", provider: "vk_video", expected: []Capability{CapabilityRead}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if actual := CapabilitiesFor(test.provider, test.scopes); !reflect.DeepEqual(actual, test.expected) {
				t.Fatalf("CapabilitiesFor() = %v; want %v", actual, test.expected)
			}
		})
	}
}
