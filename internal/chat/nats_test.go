package chat

import "testing"

func TestDecodeStreamEventRejectsUnknownEventType(t *testing.T) {
	if _, err := decodeStreamEvent([]byte(`{"type":"unknown"}`)); err == nil {
		t.Fatal("unknown event type was accepted")
	}
}

func TestDecodeStreamEventAcceptsValidState(t *testing.T) {
	event, err := decodeStreamEvent([]byte(`{"type":"state","sourceId":"019c58be-a09e-7000-8000-000000000001","state":"live"}`))
	if err != nil || event.State != "live" {
		t.Fatalf("event=%#v err=%v", event, err)
	}
}

func TestResourcesForNamespace(t *testing.T) {
	resources, err := resourcesForNamespace("feature_a_12ab34cd")
	if err != nil {
		t.Fatal(err)
	}
	if resources.stream != "FEATURE_A_12AB34CD_CHAT_EVENTS" {
		t.Fatalf("stream = %q", resources.stream)
	}
	if resources.subjectPrefix != "feature_a_12ab34cd.chat.user" {
		t.Fatalf("subject prefix = %q", resources.subjectPrefix)
	}
	if resources.deadLetterStream != "FEATURE_A_12AB34CD_CHAT_DEAD_LETTERS" || resources.deadLetterSubject != "feature_a_12ab34cd.chat.dead_letter" {
		t.Fatalf("dead letter resources = %q, %q", resources.deadLetterStream, resources.deadLetterSubject)
	}
	if resources.collectorLeaseBucket != "feature_a_12ab34cd_chat_collectors" {
		t.Fatalf("collector lease bucket = %q", resources.collectorLeaseBucket)
	}
}

func TestResourcesForEmptyNamespacePreservesProductionNames(t *testing.T) {
	resources, err := resourcesForNamespace("")
	if err != nil {
		t.Fatal(err)
	}
	if resources.stream != chatStream || resources.subjectPrefix != chatSubjectPrefix || resources.deadLetterStream != chatDeadLetterStream || resources.deadLetterSubject != chatDeadLetterSubject {
		t.Fatalf("resources = %#v", resources)
	}
}

func TestResourcesForNamespaceRejectsInvalidValue(t *testing.T) {
	for _, namespace := range []string{"UPPERCASE", "contains.dot", "-leading", "a namespace"} {
		if _, err := resourcesForNamespace(namespace); err == nil {
			t.Errorf("resourcesForNamespace(%q) succeeded", namespace)
		}
	}
}

func TestWorktreeNamespacesFromResources(t *testing.T) {
	namespaces := worktreeNamespacesFromResources(
		[]string{"CHAT_EVENTS", "WT_1234ABCD_CHAT_EVENTS", "WT_DEADBEEF_CHAT_DEAD_LETTERS", "UNRELATED"},
		[]string{"wt_1234abcd_chat_collectors", "wt_deadbeef_chat_source_states", "chat_collectors"},
	)
	want := []string{"wt_1234abcd", "wt_deadbeef"}
	if len(namespaces) != len(want) {
		t.Fatalf("namespaces = %q", namespaces)
	}
	for index := range want {
		if namespaces[index] != want[index] {
			t.Fatalf("namespaces = %q", namespaces)
		}
	}
}
