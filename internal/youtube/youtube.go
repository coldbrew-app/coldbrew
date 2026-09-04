package youtube

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

var (
	urlPattern             = regexp.MustCompile(`(?i)(?:(?:https?://)|(?:www\.))(?:[a-z0-9-]+\.)*(?:youtube\.com|youtube-nocookie\.com)(?:/[^\s<>]*)?|(?:(?:https?://)|(?:www\.))youtu\.be(?:/[^\s<>]*)?`)
	timestampPattern       = regexp.MustCompile(`^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$`)
	lengthSecondsPattern   = regexp.MustCompile(`(?:"|\\")lengthSeconds(?:"|\\")\s*:\s*(?:"|\\")(\d+)`)
	approxDurationPattern  = regexp.MustCompile(`(?:"|\\")approxDurationMs(?:"|\\")\s*:\s*(?:"|\\")(\d+)`)
	clientVersionPattern   = regexp.MustCompile(`(?:"|\\")INNERTUBE_CLIENT_VERSION(?:"|\\")\s*:\s*(?:"|\\")([^"\\]+)`)
	trailingURLPunctuation = regexp.MustCompile(`[!.,;:?)\]}]+$`)
)

type Timing struct {
	StartSeconds    int
	EndSeconds      int
	DurationSeconds int
}

type RequestedTiming struct {
	StartSeconds int
	EndSeconds   *int
}

type HTTPError struct {
	Status int
	URL    string
}

func (e *HTTPError) Error() string {
	return fmt.Sprintf("http error: GET %s returned %d", e.URL, e.Status)
}

type TransportError struct{ Err error }

func (e *TransportError) Error() string { return "youtube transport: " + e.Err.Error() }

func (e *TransportError) Unwrap() error { return e.Err }

func ExtractURLs(message string) []string {
	matches := urlPattern.FindAllString(message, -1)
	result := make([]string, 0, len(matches))
	seen := make(map[string]struct{}, len(matches))
	for _, match := range matches {
		match = trailingURLPunctuation.ReplaceAllString(match, "")
		parsed, err := parseURL(match)
		if err != nil || !isYoutubeURL(parsed) {
			continue
		}
		parsed.Scheme = "https"
		canonical := parsed.String()
		if _, exists := seen[canonical]; exists {
			continue
		}
		seen[canonical] = struct{}{}
		result = append(result, canonical)
	}
	return result
}

func VideoID(rawURL string) (string, bool) {
	parsed, err := parseURL(rawURL)
	if err != nil || !isYoutubeURL(parsed) {
		return "", false
	}

	host := strings.ToLower(parsed.Hostname())
	if host == "youtu.be" {
		id := strings.Split(strings.TrimPrefix(parsed.Path, "/"), "/")[0]
		return id, id != ""
	}
	if id := parsed.Query().Get("v"); id != "" {
		return id, true
	}
	parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
	if len(parts) >= 2 && (parts[0] == "embed" || parts[0] == "shorts") && parts[1] != "" {
		return parts[1], true
	}
	return "", false
}

func ParseTimestamp(value string) (int, bool) {
	if value == "" {
		return 0, false
	}
	if seconds, err := strconv.Atoi(value); err == nil && seconds >= 0 {
		return seconds, true
	}
	match := timestampPattern.FindStringSubmatch(value)
	if match == nil || match[0] == "" {
		return 0, false
	}
	hours, errHours := strconv.Atoi(zeroIfEmpty(match[1]))
	minutes, errMinutes := strconv.Atoi(zeroIfEmpty(match[2]))
	seconds, errSeconds := strconv.Atoi(zeroIfEmpty(match[3]))
	if errHours != nil || errMinutes != nil || errSeconds != nil {
		return 0, false
	}
	return hours*3600 + minutes*60 + seconds, true
}

func GetTiming(ctx context.Context, client *http.Client, rawURL string, requested *RequestedTiming) (Timing, error) {
	parsed, err := parseURL(rawURL)
	if err != nil || !isYoutubeURL(parsed) {
		return Timing{}, errors.New("youtube: invalid url")
	}

	body, err := fetch(ctx, client, http.MethodGet, rawURL, "", nil)
	if err != nil {
		return Timing{}, err
	}
	duration, ok := durationSeconds(body)
	if !ok {
		providerVideoID, idOK := VideoID(rawURL)
		versionMatch := clientVersionPattern.FindStringSubmatch(body)
		if !idOK || versionMatch == nil {
			return Timing{}, errors.New("youtube: duration not found")
		}
		version := versionMatch[1]
		requestBody := fmt.Sprintf(`{"videoId":%q,"context":{"client":{"clientName":"WEB","clientVersion":%q}}}`, providerVideoID, version)
		headers := map[string]string{
			"content-type":             "application/json",
			"x-youtube-client-name":    "1",
			"x-youtube-client-version": version,
		}
		body, err = fetch(ctx, client, http.MethodPost, "https://www.youtube.com/youtubei/v1/player?prettyPrint=false", requestBody, headers)
		if err != nil {
			return Timing{}, err
		}
		duration, ok = durationSeconds(body)
		if !ok {
			return Timing{}, errors.New("youtube: duration not found")
		}
	}
	return timingFromDuration(parsed, duration, requested)
}

func fetch(ctx context.Context, client *http.Client, method, rawURL, body string, headers map[string]string) (string, error) {
	request, err := http.NewRequestWithContext(ctx, method, rawURL, strings.NewReader(body))
	if err != nil {
		return "", err
	}
	for name, value := range headers {
		request.Header.Set(name, value)
	}
	response, err := client.Do(request)
	if err != nil {
		return "", &TransportError{Err: err}
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", &HTTPError{Status: response.StatusCode, URL: rawURL}
	}
	bytes, err := io.ReadAll(response.Body)
	if err != nil {
		return "", &TransportError{Err: err}
	}
	return string(bytes), nil
}

func timingFromDuration(parsed *url.URL, duration int, requested *RequestedTiming) (Timing, error) {
	if duration <= 0 {
		return Timing{}, fmt.Errorf("youtube: invalid duration: %d", duration)
	}
	if requested != nil {
		end := duration
		if requested.EndSeconds != nil {
			end = *requested.EndSeconds
		}
		if requested.StartSeconds < 0 || end <= requested.StartSeconds || end > duration {
			return Timing{}, fmt.Errorf("youtube: invalid timing: start=%d end=%d duration=%d", requested.StartSeconds, end, duration)
		}
		return Timing{StartSeconds: requested.StartSeconds, EndSeconds: end, DurationSeconds: duration}, nil
	}

	end := duration
	if requestedEnd, ok := ParseTimestamp(parsed.Query().Get("end")); ok && requestedEnd > 0 && requestedEnd <= duration {
		end = requestedEnd
	}
	return Timing{StartSeconds: 0, EndSeconds: end, DurationSeconds: duration}, nil
}

func durationSeconds(body string) (int, bool) {
	if match := lengthSecondsPattern.FindStringSubmatch(body); match != nil {
		value, err := strconv.Atoi(match[1])
		return value, err == nil
	}
	if match := approxDurationPattern.FindStringSubmatch(body); match != nil {
		milliseconds, err := strconv.ParseInt(match[1], 10, 64)
		return int(milliseconds / 1000), err == nil
	}
	return 0, false
}

func parseURL(rawURL string) (*url.URL, error) {
	if strings.HasPrefix(strings.ToLower(rawURL), "www.") {
		rawURL = "https://" + rawURL
	}
	return url.ParseRequestURI(rawURL)
}

func isYoutubeURL(parsed *url.URL) bool {
	if parsed == nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	return host == "youtu.be" || host == "youtube.com" || strings.HasSuffix(host, ".youtube.com") || host == "youtube-nocookie.com" || strings.HasSuffix(host, ".youtube-nocookie.com")
}

func zeroIfEmpty(value string) string {
	if value == "" {
		return "0"
	}
	return value
}
