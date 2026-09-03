package main

import (
	"os"
	"testing"
)

func TestConfiguredPairRequiresBothValues(t *testing.T) {
	t.Setenv("TEST_CLIENT_ID", "client")
	if _, err := configuredPair("TEST_CLIENT_ID", "TEST_CLIENT_SECRET"); err == nil {
		t.Fatal("expected incomplete pair to fail")
	}
	t.Setenv("TEST_CLIENT_SECRET", "secret")
	pair, err := configuredPair("TEST_CLIENT_ID", "TEST_CLIENT_SECRET")
	if err != nil || pair == nil || pair[0] != "client" || pair[1] != "secret" {
		t.Fatalf("pair=%#v err=%v", pair, err)
	}
}

func TestLoadConfigUsesDocumentedDefaults(t *testing.T) {
	for _, name := range []string{"CHAT_TOKEN_ENCRYPTION_SECRET", "CHAT_PUBLIC_URL", "CHAT_WEB_URL", "YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET", "KICK_CLIENT_ID", "KICK_CLIENT_SECRET", "KICK_WEBHOOK_PUBLIC_KEY"} {
		t.Setenv(name, "")
	}
	t.Setenv("DATABASE_URL", "postgresql://localhost/coldbrew")
	t.Setenv("APP_DOMAIN", "https://coldbrew.example")
	t.Setenv("BETTER_AUTH_SECRET", "12345678901234567890123456789012")
	t.Setenv("CHAT_SERVICE_SECRET", "chat-service-secret-with-32-characters")
	t.Setenv("CHAT_PORT", "3001")
	config, err := loadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if config.publicURL != "https://coldbrew.example/api/chat" || config.webURL != "https://coldbrew.example" || config.port != 3001 {
		t.Fatalf("config = %#v", config)
	}
	if config.natsServers == "" || config.serviceSecret != os.Getenv("CHAT_SERVICE_SECRET") {
		t.Fatalf("config = %#v", config)
	}
}
