package youtube

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type videoMetadata struct {
	ID      string `json:"id"`
	Snippet struct {
		Title                string `json:"title"`
		LiveBroadcastContent string `json:"liveBroadcastContent"`
	} `json:"snippet"`
	ContentDetails struct {
		Duration string `json:"duration"`
	} `json:"contentDetails"`
}

func getMetadata(ctx context.Context, client *http.Client, apiKey, rawURL string) (videoMetadata, error) {
	id, ok := VideoID(rawURL)
	if !ok {
		return videoMetadata{}, errors.New("youtube: invalid url")
	}
	if apiKey == "" {
		return videoMetadata{}, errors.New("youtube: API key is required")
	}
	endpoint := "https://www.googleapis.com/youtube/v3/videos?" + url.Values{
		"id":     {id},
		"part":   {"contentDetails,snippet"},
		"fields": {"items(id,contentDetails(duration),snippet(title,liveBroadcastContent))"},
	}.Encode()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return videoMetadata{}, err
	}
	// Keep credentials out of URLs and do not forward them through redirects.
	request.Header.Set("X-Goog-Api-Key", apiKey)
	safeClient := *client
	safeClient.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	response, err := safeClient.Do(request)
	if err != nil {
		return videoMetadata{}, &TransportError{Err: err}
	}
	defer response.Body.Close()
	const maxBody = 1 << 20
	body, err := io.ReadAll(io.LimitReader(response.Body, maxBody+1))
	if err != nil {
		return videoMetadata{}, &TransportError{Err: err}
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		failure := &HTTPError{Status: response.StatusCode, URL: "https://www.googleapis.com/youtube/v3/videos"}
		if seconds, err := strconv.Atoi(response.Header.Get("Retry-After")); err == nil && seconds > 0 && seconds <= 604800 {
			failure.RetryAfter = time.Duration(seconds) * time.Second
		} else if date, err := http.ParseTime(response.Header.Get("Retry-After")); err == nil {
			failure.RetryAfter = max(0, time.Until(date))
		}
		var result struct {
			Error struct {
				Errors []struct {
					Reason string `json:"reason"`
				} `json:"errors"`
				Details []struct {
					Reason string `json:"reason"`
				} `json:"details"`
			} `json:"error"`
		}
		if len(body) <= maxBody && json.Unmarshal(body, &result) == nil {
			// Only persist bounded categories; provider messages may contain credentials.
			reasons := []string{}
			for _, item := range result.Error.Errors {
				reasons = append(reasons, item.Reason)
			}
			for _, item := range result.Error.Details {
				reasons = append(reasons, item.Reason)
			}
			for _, reason := range reasons {
				switch strings.ToLower(reason) {
				case "quotaexceeded", "dailylimitexceeded":
					failure.Reason = "quota_exceeded"
					failure.RetryAfter = max(failure.RetryAfter, 24*time.Hour)
				case "keyinvalid", "accessnotconfigured", "api_key_invalid", "api_key_service_blocked", "api_key_ip_address_blocked", "service_disabled":
					if failure.Reason == "" {
						failure.Reason = "api_configuration"
					}
				}
			}
		}
		return videoMetadata{}, failure
	}
	var result struct {
		Items []videoMetadata `json:"items"`
	}
	if len(body) > maxBody || json.Unmarshal(body, &result) != nil {
		return videoMetadata{}, errors.New("youtube: invalid metadata response")
	}
	for _, item := range result.Items {
		if item.ID == id {
			return item, nil
		}
	}
	// An empty list cannot establish whether the video is private or deleted.
	return videoMetadata{}, errors.New("youtube: video metadata unavailable")
}
