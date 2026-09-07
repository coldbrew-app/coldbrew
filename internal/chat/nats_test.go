package chat

import "testing"

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
	if resources.collectorLeaseBucket != "feature_a_12ab34cd_chat_collectors" {
		t.Fatalf("collector lease bucket = %q", resources.collectorLeaseBucket)
	}
}

func TestResourcesForEmptyNamespacePreservesProductionNames(t *testing.T) {
	resources, err := resourcesForNamespace("")
	if err != nil {
		t.Fatal(err)
	}
	if resources.stream != chatStream || resources.subjectPrefix != chatSubjectPrefix {
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
		[]string{"CHAT_EVENTS", "WT_1234ABCD_CHAT_EVENTS", "UNRELATED"},
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
