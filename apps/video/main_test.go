package main

import (
	"testing"
)

func TestRequiresYouTubeAPIKey(t *testing.T) {
	t.Setenv("YOUTUBE_API_KEY", "  ")
	if err := run(); err == nil || err.Error() != "YOUTUBE_API_KEY is required" {
		t.Fatalf("expected clear startup configuration error, got %v", err)
	}
}
