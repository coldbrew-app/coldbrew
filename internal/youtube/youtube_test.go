package youtube

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"reflect"
	"strings"
	"testing"
	"time"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (function roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

func TestExtractURLs(t *testing.T) {
	actual := ExtractURLs("Play https://youtu.be/dQw4w9WgXcQ! Also www.youtube.com/watch?v=dQw4w9WgXcQ and https://youtu.be/dQw4w9WgXcQ")
	expected := []string{"https://youtu.be/dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}
	if !reflect.DeepEqual(actual, expected) {
		t.Fatalf("ExtractURLs() = %#v; want %#v", actual, expected)
	}
	if actual := ExtractURLs("https://notyoutube.com/watch?v=123"); len(actual) != 0 {
		t.Fatalf("expected non-YouTube URL to be ignored, got %#v", actual)
	}
	if actual := ExtractURLs("http://youtu.be/dQw4w9WgXcQ"); !reflect.DeepEqual(actual, []string{"https://youtu.be/dQw4w9WgXcQ"}) {
		t.Fatalf("expected HTTP URL to be upgraded, got %#v", actual)
	}
}

func TestVideoID(t *testing.T) {
	for rawURL, expected := range map[string]string{
		"https://youtu.be/dQw4w9WgXcQ":               "dQw4w9WgXcQ",
		"https://www.youtube.com/shorts/dQw4w9WgXcQ": "dQw4w9WgXcQ",
	} {
		actual, ok := VideoID(rawURL)
		if !ok || actual != expected {
			t.Fatalf("VideoID(%q) = %q, %v; want %q, true", rawURL, actual, ok, expected)
		}
	}
	for _, rawURL := range []string{"not a url", "https://example.com/watch?v=dQw4w9WgXcQ"} {
		if _, ok := VideoID(rawURL); ok {
			t.Fatalf("expected VideoID(%q) to reject URL", rawURL)
		}
	}
}

func TestParseTimestamp(t *testing.T) {
	valid := map[string]int{"90": 90, "1m30s": 90, "2h3m4s": 7384, "15s": 15}
	for value, expected := range valid {
		actual, ok := ParseTimestamp(value)
		if !ok || actual != expected {
			t.Fatalf("ParseTimestamp(%q) = %d, %v; want %d, true", value, actual, ok, expected)
		}
	}
	for _, value := range []string{"", "1:30", "abc", "-1", "1m30"} {
		if _, ok := ParseTimestamp(value); ok {
			t.Fatalf("expected ParseTimestamp(%q) to reject value", value)
		}
	}
}

func metadataBody(id, duration, title, live string) string {
	body, _ := json.Marshal(map[string]any{"items": []any{map[string]any{
		"id": id, "contentDetails": map[string]string{"duration": duration},
		"snippet": map[string]string{"title": title, "liveBroadcastContent": live},
	}}})
	return string(body)
}

func TestDataAPITiming(t *testing.T) {
	for _, test := range []struct {
		duration string
		seconds  int
	}{
		{"PT3M33S", 213}, {"PT2H1M", 7260}, {"P1DT2H3M4S", 93784}, {"P2D", 172800},
		{"PT90S", 90}, {"PT2147483647S", 2147483647},
	} {
		t.Run(test.duration, func(t *testing.T) {
			calls := 0
			client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
				calls++
				if r.Method != "GET" || r.URL.Host != "www.googleapis.com" || r.URL.Path != "/youtube/v3/videos" ||
					r.URL.Query().Get("id") != "dQw4w9WgXcQ" || r.URL.Query().Get("part") != "contentDetails,snippet" ||
					r.Header.Get("X-Goog-Api-Key") != "test-key" || strings.Contains(r.URL.String(), "test-key") {
					t.Fatalf("unexpected API request: %s", r.URL)
				}
				return response(200, metadataBody("dQw4w9WgXcQ", test.duration, "  Название видео  ", "none")), nil
			})}
			timing, err := GetTiming(context.Background(), client, "test-key", "https://youtu.be/dQw4w9WgXcQ?t=13s", nil)
			if err != nil || timing.DurationSeconds != test.seconds || timing.EndSeconds != test.seconds || timing.StartSeconds != 0 ||
				timing.Title != "Название видео" || calls != 1 {
				t.Fatalf("timing=%+v err=%v calls=%d", timing, err, calls)
			}
		})
	}
}

func TestTimingRanges(t *testing.T) {
	for _, test := range []struct {
		url       string
		requested *RequestedTiming
		end       int
	}{
		{"https://youtu.be/id?end=180", nil, 180},
		{"https://youtu.be/id?end=300", nil, 213},
		{"https://youtu.be/id?t=1m15s", &RequestedTiming{StartSeconds: 30}, 213},
		{"https://youtu.be/id", &RequestedTiming{StartSeconds: 30, EndSeconds: integerPointer(90)}, 90},
	} {
		timing, err := GetTiming(context.Background(), responseClient(metadataBody("id", "PT3M33S", "", "none")), "key", test.url, test.requested)
		if err != nil || timing.EndSeconds != test.end {
			t.Fatalf("%+v %v", timing, err)
		}
	}
	for _, requested := range []RequestedTiming{
		{StartSeconds: 213}, {StartSeconds: -1}, {StartSeconds: 30, EndSeconds: integerPointer(30)},
		{StartSeconds: 30, EndSeconds: integerPointer(214)},
	} {
		_, err := GetTiming(context.Background(), responseClient(metadataBody("id", "PT3M33S", "", "none")), "key", "https://youtu.be/id", &requested)
		if err == nil {
			t.Fatal("accepted invalid timing")
		}
	}
}

func TestUnknownDurationPreservesTitle(t *testing.T) {
	for _, duration := range []string{"", "PT0S", "P", "PT", "P1DT", "PT-1S", "PT1.5S", "garbage", "PT2147483648S", "P99999999999999999999D"} {
		timing, err := GetTiming(context.Background(), responseClient(metadataBody("id", duration, "Title", "none")), "key", "https://youtu.be/id", nil)
		if err == nil || timing.Title != "Title" || timing.DurationSeconds != 0 {
			t.Fatalf("%s: %+v %v", duration, timing, err)
		}
	}
	for _, live := range []string{"live", "upcoming"} {
		body := metadataBody("id", "PT1H", "Live title", live)
		timing, err := GetTiming(context.Background(), responseClient(body), "key", "https://youtu.be/id", nil)
		if err == nil || timing.Title != "Live title" || timing.DurationSeconds != 0 {
			t.Fatalf("%+v %v", timing, err)
		}
		title, err := GetTitle(context.Background(), responseClient(body), "key", "https://youtu.be/id")
		if err != nil || title != "Live title" {
			t.Fatalf("%s %v", title, err)
		}
	}
}

func TestDataAPIErrors(t *testing.T) {
	for _, test := range []struct {
		status       int
		body, reason string
		delay        time.Duration
	}{
		{429, "", "", 120 * time.Second},
		{503, "", "", 120 * time.Second},
		{403, `{"error":{"errors":[{"reason":"quotaExceeded","message":"secret-key"}]}}`, "quota_exceeded", 24 * time.Hour},
		{400, `{"error":{"details":[{"reason":"API_KEY_INVALID"}]}}`, "api_configuration", 120 * time.Second},
		{403, `{"error":{"errors":[{"reason":"forbidden"}]}}`, "", 120 * time.Second},
	} {
		t.Run(fmt.Sprint(test.status, test.reason), func(t *testing.T) {
			client := &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
				res := response(test.status, test.body)
				res.Header.Set("Retry-After", "120")
				return res, nil
			})}
			_, err := GetTiming(context.Background(), client, "secret-key", "https://youtu.be/id", nil)
			var failure *HTTPError
			if !errors.As(err, &failure) || failure.Status != test.status || failure.Reason != test.reason || failure.RetryAfter != test.delay ||
				strings.Contains(err.Error(), "secret-key") {
				t.Fatalf("failure=%+v err=%v", failure, err)
			}
		})
	}
	for _, body := range []string{`{"items":[]}`, "{}", "not json", strings.Repeat("x", (1<<20)+1), metadataBody("other", "PT10S", "Wrong video", "none")} {
		_, err := GetTiming(context.Background(), responseClient(body), "key", "https://youtu.be/id", nil)
		if err == nil {
			t.Fatal("accepted invalid response")
		}
	}
	client := &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) { return nil, errors.New("connection reset") })}
	_, err := GetTiming(context.Background(), client, "key", "https://youtu.be/id", nil)
	var transport *TransportError
	if !errors.As(err, &transport) {
		t.Fatalf("expected transport error: %v", err)
	}
}

func TestInvalidInputDoesNotFetch(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) { t.Fatal("unexpected request"); return nil, nil })}
	for _, input := range []struct{ key, url string }{{"key", "https://example.com/watch?v=id"}, {"key", "https://youtube.com/"}, {"", "https://youtu.be/id"}} {
		if _, err := GetTiming(context.Background(), client, input.key, input.url, nil); err == nil {
			t.Fatal("accepted invalid input")
		}
	}
}

func TestTitleWithoutDuration(t *testing.T) {
	title, err := GetTitle(context.Background(), responseClient(metadataBody("id", "", "  Title  ", "none")), "key", "https://youtu.be/id")
	if err != nil || title != "Title" {
		t.Fatalf("%s %v", title, err)
	}
	if _, err := GetTitle(context.Background(), responseClient(metadataBody("id", "PT10S", "  ", "none")), "key", "https://youtu.be/id"); err == nil {
		t.Fatal("accepted empty title")
	}
}

func responseClient(body string) *http.Client {
	return &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) { return response(200, body), nil })}
}
func response(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}
}
func integerPointer(value int) *int { return &value }
