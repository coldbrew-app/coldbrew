package youtube

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

// GetTitle reads public video metadata without fetching or changing playback timing.
func GetTitle(ctx context.Context, client *http.Client, rawURL string) (string, error) {
	id, ok := VideoID(rawURL)
	if !ok {
		return "", errors.New("youtube: invalid url")
	}
	endpoint := "https://www.youtube.com/oembed?" + url.Values{
		"url":    {"https://www.youtube.com/watch?v=" + url.QueryEscape(id)},
		"format": {"json"},
	}.Encode()
	body, err := fetch(ctx, client, http.MethodGet, endpoint, "", nil)
	if err != nil {
		return "", err
	}
	var metadata struct {
		Title string `json:"title"`
	}
	if err := json.Unmarshal([]byte(body), &metadata); err != nil {
		return "", fmt.Errorf("youtube: invalid title response: %w", err)
	}
	title := strings.TrimSpace(metadata.Title)
	if title == "" {
		return "", errors.New("youtube: title not found")
	}
	return title, nil
}
