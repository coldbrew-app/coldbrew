package observability

import (
	"errors"
	"log/slog"
	"testing"
)

func TestAddAttrPreservesGroupsAndErrors(t *testing.T) {
	fields := make(map[string]any)
	addAttr(fields, []string{"request"}, slog.Any("error", errors.New("failed")))
	request, ok := fields["request"].(map[string]any)
	if !ok || request["error"] != "failed" {
		t.Fatalf("fields = %#v", fields)
	}
}

func TestNatsResourcesAreNamespaced(t *testing.T) {
	if got := LogSubject("branch-1", "video"); got != "branch-1.ops.logs.video" {
		t.Fatalf("subject = %q", got)
	}
	if got := LogStreamName("branch-1"); got != "CB_BRANCH-1_OPERATIONAL_LOGS" {
		t.Fatalf("stream = %q", got)
	}
}

func TestAddAttrRedactsSensitiveValues(t *testing.T) {
	fields := make(map[string]any)
	addAttr(fields, nil, slog.String("access_token", "secret-value"))
	if fields["access_token"] != "[REDACTED]" {
		t.Fatalf("fields = %#v", fields)
	}
}
