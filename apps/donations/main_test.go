package main

import "testing"

func TestLoadConfigUsesDocumentedDefaults(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgresql://localhost/coldbrew")
	t.Setenv("APP_DOMAIN", "https://coldbrew.test")
	t.Setenv("DONATION_ALERTS_CLIENT_ID", "42")
	t.Setenv("DONATION_ALERTS_CLIENT_SECRET", "provider-secret")
	t.Setenv("STREAMLABS_CLIENT_ID", "streamlabs-client")
	t.Setenv("STREAMLABS_CLIENT_SECRET", "streamlabs-secret")
	t.Setenv("DONATIONS_SERVICE_SECRET", "donations-service-secret-with-32-characters")
	t.Setenv("DONATIONS_PORT", "")
	config, err := loadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if config.port != 3002 || config.serviceSecret != "donations-service-secret-with-32-characters" || config.streamlabsRedirectURI != "https://coldbrew.test/api/integration/streamlabs/callback" {
		t.Fatalf("config = %#v", config)
	}
}

func TestLoadConfigRequiresPrivateServiceSecret(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgresql://localhost/coldbrew")
	t.Setenv("APP_DOMAIN", "https://coldbrew.test")
	t.Setenv("DONATION_ALERTS_CLIENT_ID", "42")
	t.Setenv("DONATION_ALERTS_CLIENT_SECRET", "provider-secret")
	t.Setenv("STREAMLABS_CLIENT_ID", "streamlabs-client")
	t.Setenv("STREAMLABS_CLIENT_SECRET", "streamlabs-secret")
	t.Setenv("DONATIONS_SERVICE_SECRET", "short")
	if _, err := loadConfig(); err == nil {
		t.Fatal("expected short service secret to fail")
	}
}

func TestLoadConfigRequiresStreamlabsCredentials(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgresql://localhost/coldbrew")
	t.Setenv("APP_DOMAIN", "https://coldbrew.test")
	t.Setenv("DONATION_ALERTS_CLIENT_ID", "42")
	t.Setenv("DONATION_ALERTS_CLIENT_SECRET", "provider-secret")
	t.Setenv("STREAMLABS_CLIENT_ID", "")
	t.Setenv("STREAMLABS_CLIENT_SECRET", "")
	t.Setenv("DONATIONS_SERVICE_SECRET", "donations-service-secret-with-32-characters")
	if _, err := loadConfig(); err == nil {
		t.Fatal("expected missing Streamlabs credentials to fail")
	}
}
