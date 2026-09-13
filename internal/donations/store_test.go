package donations

import (
	"testing"
	"time"

	"github.com/lebedev-nikita/coldbrew/internal/donatestream"
)

func TestOrderedDonationsDoesNotMutateAndUsesOldestFirst(t *testing.T) {
	base := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	donations := []Donation{
		{SourceDonationID: "later", OccurredAt: base.Add(time.Minute)},
		{SourceDonationID: "same-b", OccurredAt: base},
		{SourceDonationID: "same-a", OccurredAt: base},
	}
	ordered := orderedDonations(donations)
	if donations[0].SourceDonationID != "later" {
		t.Fatal("input donations were mutated")
	}
	want := []string{"same-a", "same-b", "later"}
	for index, id := range want {
		if ordered[index].SourceDonationID != id {
			t.Fatalf("ordered[%d] = %q, want %q", index, ordered[index].SourceDonationID, id)
		}
	}
}

func TestOrderedDonateStreamDonationsUsesOldestFirst(t *testing.T) {
	base := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	donations := []donatestream.Donation{
		{SourceDonationID: "new", OccurredAt: base.Add(time.Second)},
		{SourceDonationID: "old", OccurredAt: base},
	}
	ordered := orderedDonateStreamDonations(donations)
	if ordered[0].SourceDonationID != "old" || donations[0].SourceDonationID != "new" {
		t.Fatalf("ordered=%#v input=%#v", ordered, donations)
	}
}
