package youtube

import (
	"context"
	"io"
	"net/http"
	"reflect"
	"strings"
	"testing"
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

func TestGetTiming(t *testing.T) {
	tests := []struct {
		name      string
		rawURL    string
		body      string
		requested *RequestedTiming
		expected  Timing
	}{
		{name: "exact length", rawURL: "https://youtu.be/dQw4w9WgXcQ", body: `{"lengthSeconds":"213"}`, expected: Timing{0, 213, 213}},
		{name: "approximate duration", rawURL: "https://www.youtube.com/watch?v=_JXL6Fn99l8&t=13s", body: `{"approxDurationMs":"7260183"}`, expected: Timing{0, 7260, 7260}},
		{name: "valid end", rawURL: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m15s&end=180", body: `{"lengthSeconds":"213"}`, expected: Timing{0, 180, 213}},
		{name: "requested range", rawURL: "https://youtu.be/dQw4w9WgXcQ", body: `{"lengthSeconds":"213"}`, requested: &RequestedTiming{StartSeconds: 30, EndSeconds: integerPointer(90)}, expected: Timing{30, 90, 213}},
		{name: "requested open end", rawURL: "https://youtu.be/dQw4w9WgXcQ?end=180", body: `{"lengthSeconds":"213"}`, requested: &RequestedTiming{StartSeconds: 30}, expected: Timing{30, 213, 213}},
		{name: "invalid start falls back", rawURL: "https://youtu.be/dQw4w9WgXcQ?t=300", body: `{"lengthSeconds":"213"}`, expected: Timing{0, 213, 213}},
		{name: "invalid range uses end", rawURL: "https://youtu.be/dQw4w9WgXcQ?t=30&end=20", body: `{"lengthSeconds":"213"}`, expected: Timing{0, 20, 213}},
		{name: "invalid end falls back", rawURL: "https://youtu.be/dQw4w9WgXcQ?start=nope&end=300", body: `{"lengthSeconds":"213"}`, expected: Timing{0, 213, 213}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			client := responseClient(test.body)
			actual, err := GetTiming(context.Background(), client, test.rawURL, test.requested)
			if err != nil {
				t.Fatal(err)
			}
			if actual != test.expected {
				t.Fatalf("GetTiming() = %#v; want %#v", actual, test.expected)
			}
		})
	}
}

func TestGetTimingFallsBackToPlayerMetadata(t *testing.T) {
	calls := 0
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		calls++
		body := `{"INNERTUBE_CLIENT_VERSION":"2.20260824.01.00"}`
		if calls == 2 {
			body = `{"videoDetails":{"lengthSeconds":"7260"}}`
			if request.Method != http.MethodPost || request.URL.String() != "https://www.youtube.com/youtubei/v1/player?prettyPrint=false" {
				t.Fatalf("unexpected player request: %s %s", request.Method, request.URL)
			}
		}
		return response(http.StatusOK, body), nil
	})}
	actual, err := GetTiming(context.Background(), client, "https://www.youtube.com/watch?v=_JXL6Fn99l8&t=13s", nil)
	if err != nil {
		t.Fatal(err)
	}
	if actual != (Timing{0, 7260, 7260}) || calls != 2 {
		t.Fatalf("GetTiming() = %#v after %d calls", actual, calls)
	}
}

func TestGetTimingRejectsInvalidRequestedRanges(t *testing.T) {
	for _, requested := range []RequestedTiming{
		{StartSeconds: 213},
		{StartSeconds: 30, EndSeconds: integerPointer(30)},
		{StartSeconds: 30, EndSeconds: integerPointer(214)},
	} {
		_, err := GetTiming(context.Background(), responseClient(`{"lengthSeconds":"213"}`), "https://youtu.be/dQw4w9WgXcQ", &requested)
		if err == nil || !strings.Contains(err.Error(), "youtube: invalid timing") {
			t.Fatalf("expected invalid timing error, got %v", err)
		}
	}
}

func TestGetTimingRejectsUnsupportedURLWithoutFetching(t *testing.T) {
	called := false
	client := &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		called = true
		return response(http.StatusOK, ""), nil
	})}
	_, err := GetTiming(context.Background(), client, "https://example.com/watch?v=dQw4w9WgXcQ", nil)
	if err == nil || err.Error() != "youtube: invalid url" || called {
		t.Fatalf("expected invalid URL without fetch, got err=%v called=%v", err, called)
	}
}

func responseClient(body string) *http.Client {
	return &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return response(http.StatusOK, body), nil
	})}
}

func response(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}
}

func integerPointer(value int) *int { return &value }
