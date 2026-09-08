package youtube

import (
	"context"
	"errors"
	"net/http"
	"strings"
)

// GetTitle uses the same Data API response without requiring a final duration.
func GetTitle(ctx context.Context, client *http.Client, apiKey, rawURL string) (string, error) {
	metadata, err := getMetadata(ctx, client, apiKey, rawURL)
	if err != nil {
		return "", err
	}
	title := strings.TrimSpace(metadata.Snippet.Title)
	if title == "" {
		return "", errors.New("youtube: title not found")
	}
	return title, nil
}
