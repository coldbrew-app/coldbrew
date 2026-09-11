package donatestream

import "testing"

func TestParseWidgetURLReadsCanonicalCredentials(t *testing.T) {
	connection, err := ParseWidgetURL("  https://donate.stream/widget-alert?uid=group-42&token=1234567890abcdef  ")
	if err != nil {
		t.Fatal(err)
	}
	if connection != (Connection{WidgetGroupUID: "group-42", WidgetToken: "1234567890abcdef"}) {
		t.Fatalf("connection=%#v", connection)
	}
}

func TestParseWidgetURLRejectsLookalikeAndIncompleteURLs(t *testing.T) {
	for _, rawURL := range []string{
		"https://example.com/widget-alert?uid=group-42&token=1234567890abcdef",
		"https://donate.stream.evil.test/widget-alert?uid=group-42&token=1234567890abcdef",
		"https://donate.stream/widget-alert?uid=group-42",
		"https://donate.stream/donate?uid=group-42&token=1234567890abcdef",
	} {
		if _, err := ParseWidgetURL(rawURL); err == nil {
			t.Fatalf("expected %q to fail", rawURL)
		}
	}
}
