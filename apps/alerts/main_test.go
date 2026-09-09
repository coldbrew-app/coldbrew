package main

import "testing"

func TestLoadConfigRequiresTelegramToken(t *testing.T) {
	t.Setenv("TELEGRAM_BOT_TOKEN", "")
	if _, err := loadConfig(); err == nil {
		t.Fatal("expected missing Telegram configuration to fail")
	}
}

func TestLoadConfigAcceptsTokenOnly(t *testing.T) {
	t.Setenv("TELEGRAM_BOT_TOKEN", " test-token ")
	t.Setenv("TELEGRAM_ADMIN_CHAT_ID", "")
	configuration, err := loadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if configuration.telegramToken != "test-token" || configuration.telegramAdminChatID != "" {
		t.Fatalf("unexpected configuration")
	}
}
