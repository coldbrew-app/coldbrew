package chat

import (
	"context"
	"net/http"
	"os"
	"reflect"
	"testing"
	"time"

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
		{name: "boosty read only", provider: "boosty", expected: []Capability{CapabilityRead}},
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

func TestStoreSavesOptionalDeviceID(t *testing.T) {
	databaseURL := os.Getenv("CHAT_STORE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("CHAT_STORE_TEST_DATABASE_URL is required for PostgreSQL integration tests")
	}
	ctx := context.Background()
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	config.MaxConns = 1
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	_, err = pool.Exec(ctx, `
		CREATE TEMP TABLE chat_provider_connection (
			chat_provider_connection_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id integer, provider text, provider_user_id text, display_name text,
			access_token_ciphertext bytea, refresh_token_ciphertext bytea,
			oauth_device_id text CHECK (char_length(oauth_device_id) BETWEEN 1 AND 200),
			access_token_expires_at timestamptz, scopes text[],
			status text DEFAULT 'connected', token_version integer DEFAULT 1,
			updated_at timestamptz DEFAULT now(),
			UNIQUE (provider, provider_user_id)
		);
		CREATE TEMP TABLE chat_source (
			chat_provider_connection_id uuid, user_id integer, provider text,
			provider_source_id text, display_name text, source_url text,
			position integer, enabled boolean DEFAULT true, updated_at timestamptz DEFAULT now(),
			UNIQUE (user_id, provider, provider_source_id)
		);
	`)
	if err != nil {
		t.Fatal(err)
	}
	cipher, err := NewTokenCipher("store-test-secret")
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(pool, cipher)
	for _, provider := range []string{"youtube", "twitch", "kick", "vk_video", "boosty"} {
		t.Run(provider, func(t *testing.T) {
			deviceID := ""
			if provider == "vk_video" || provider == "boosty" {
				deviceID = "device-1"
			}
			connection := SaveConnection{Provider: provider, ProviderUserID: "channel", DisplayName: "Channel", AccessToken: "access", RefreshToken: "refresh", OAuthDeviceID: deviceID, Scopes: []string{}}
			source := SaveSource{Provider: provider, ProviderSourceID: "channel", DisplayName: "Channel", SourceURL: "https://example.com/channel"}
			var connectionID string
			for attempt := range 3 {
				if attempt == 1 {
					connection.OAuthDeviceID = "" // A reconnect may omit an existing device ID.
				}
				if attempt == 2 && deviceID != "" {
					deviceID = "device-2"
					connection.OAuthDeviceID = deviceID
				}
				id, err := store.SaveProviderAccount(ctx, 1, connection, source)
				if err != nil {
					t.Fatalf("save attempt %d: %v", attempt, err)
				}
				if attempt > 0 && id != connectionID {
					t.Fatal("reconnect created a different connection")
				}
				connectionID = id
				var storedDeviceID *string
				var version int
				if err := pool.QueryRow(ctx, `SELECT oauth_device_id, token_version FROM pg_temp.chat_provider_connection WHERE chat_provider_connection_id = $1`, id).Scan(&storedDeviceID, &version); err != nil {
					t.Fatal(err)
				}
				if deviceID == "" {
					if storedDeviceID != nil {
						t.Fatal("absent device ID must be SQL NULL")
					}
				} else if storedDeviceID == nil || *storedDeviceID != deviceID {
					t.Fatal("device ID was not preserved or updated")
				}
				if version != attempt+1 {
					t.Fatalf("token version = %d; want %d", version, attempt+1)
				}
			}
			var count int
			if err := pool.QueryRow(ctx, `SELECT count(*) FROM pg_temp.chat_source WHERE user_id = 1 AND provider = $1`, provider).Scan(&count); err != nil {
				t.Fatal(err)
			}
			if count != 1 {
				t.Fatalf("source count = %d; want 1", count)
			}
		})
	}
}

func TestBoostySessionExpiryAndRotationWithPostgres(t *testing.T) {
	databaseURL := os.Getenv("CHAT_STORE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("CHAT_STORE_TEST_DATABASE_URL is required for PostgreSQL integration tests")
	}
	ctx := context.Background()
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	config.MaxConns = 1
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	// Exercise the applied schema without exposing test credentials to running collectors.
	_, err = pool.Exec(ctx, `
  CREATE TEMP TABLE chat_provider_connection (LIKE public.chat_provider_connection INCLUDING ALL);
  CREATE TEMP TABLE chat_source (LIKE public.chat_source INCLUDING ALL);
 `)
	if err != nil {
		t.Fatal(err)
	}
	cipher, err := NewTokenCipher("boosty-postgres-test-secret")
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(pool, cipher)
	rotations := 0
	client := &http.Client{Transport: oauthRoundTripFunc(func(r *http.Request) (*http.Response, error) {
		switch r.URL.Path {
		case "/v1/user/current":
			return youtubeResponse(200, `{"id":42,"name":"Streamer","blogUrl":"my.blog"}`), nil
		case "/v1/blog/my.blog":
			return youtubeResponse(200, `{"owner":{"id":42}}`), nil
		case "/oauth/token/":
			rotations++
			return youtubeResponse(200, `{"access_token":"renewed","refresh_token":"rotated","expires_in":3600}`), nil
		default:
			t.Errorf("unexpected request %s", r.URL.Path)
			return youtubeResponse(404, `{}`), nil
		}
	})}
	now := time.Now().Truncate(time.Millisecond)
	expiry := now.Add(time.Hour).UnixMilli()
	input := BoostyCredentials{AccessToken: "access", RefreshToken: "refresh", DeviceID: "separate-device", ExpiresAt: &expiry, DedicatedSession: true}
	if err := NewBoostyConnector(NewBoostyProvider(client), store).Connect(ctx, 1, input); err != nil {
		t.Fatal(err)
	}
	sources, err := store.GetEnabledSources(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(sources) != 1 || sources[0].Credentials.ExpiresAt == nil || sources[0].Credentials.ExpiresAt.UnixMilli() != expiry {
		t.Fatal("imported expiry did not survive database round trip")
	}
	refresher := NewTokenRefresher(store, TokenRefreshConfigs(nil, nil, nil, nil, ""), client)
	refresher.now = func() time.Time { return now }
	if _, err := refresher.Refresh(ctx, sources[0]); err != nil {
		t.Fatal(err)
	}
	if rotations != 0 {
		t.Fatal("fresh session was rotated")
	}
	refresher.now = func() time.Time { return now.Add(time.Hour) }
	if _, err := refresher.Refresh(ctx, sources[0]); err != nil {
		t.Fatal(err)
	}
	reloaded, err := store.GetEnabledSources(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(reloaded) != 1 {
		t.Fatal("connection lost after renewal")
	}
	credentials := reloaded[0].Credentials
	if rotations != 1 || credentials.AccessToken != "renewed" || credentials.RefreshToken != "rotated" || credentials.DeviceID != "separate-device" || credentials.TokenVersion != sources[0].Credentials.TokenVersion+1 || credentials.ExpiresAt == nil || !credentials.ExpiresAt.Equal(now.Add(2*time.Hour)) {
		t.Fatal("renewed session was not persisted consistently")
	}
}
