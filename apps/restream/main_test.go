package main

import (
	"testing"
)

func TestLoadConfigRequiresIsolatedMediaPlane(t *testing.T) {
	t.Setenv("RESTREAM_NODE_ID", "fsn1-1")
	t.Setenv("RESTREAM_CONTROL_URL", "https://streambrew.app/api/restream/media")
	t.Setenv("RESTREAM_MEDIA_SHARED_SECRET", "test-restream-media-secret-32-characters")
	settings, err := loadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if settings.controllerAddress != "127.0.0.1:9998" || settings.mediaAPIURL != "http://127.0.0.1:9997" {
		t.Fatalf("loadConfig() = %#v", settings)
	}
}

func TestLoadConfigRejectsPublicControlAndMediaAPIBinds(t *testing.T) {
	t.Setenv("RESTREAM_NODE_ID", "fsn1-1")
	t.Setenv("RESTREAM_CONTROL_URL", "https://streambrew.app/api/restream/media")
	t.Setenv("RESTREAM_MEDIA_SHARED_SECRET", "test-restream-media-secret-32-characters")
	t.Setenv("RESTREAM_CONTROLLER_ADDR", "0.0.0.0:9998")
	if _, err := loadConfig(); err == nil {
		t.Fatal("loadConfig() unexpectedly accepted public callback bind")
	}

	t.Setenv("RESTREAM_CONTROLLER_ADDR", "127.0.0.1:9998")
	t.Setenv("MEDIAMTX_API_URL", "http://10.0.0.1:9997")
	if _, err := loadConfig(); err == nil {
		t.Fatal("loadConfig() unexpectedly accepted public MediaMTX API")
	}
}
