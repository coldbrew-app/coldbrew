package tourniquet

import (
	"strings"
	"testing"
	"time"
)

func TestParseWidgetURLReadsToken(t *testing.T) {
	connection, err := ParseWidgetURL("  https://tourniquet.app/widgets/alert/AbCdEf0123456789GhIjKlMn  ")
	if err != nil {
		t.Fatal(err)
	}
	if connection.WidgetToken != "AbCdEf0123456789GhIjKlMn" {
		t.Fatalf("connection=%#v", connection)
	}
}

func TestParseWidgetURLRejectsLookalikesAndExtraData(t *testing.T) {
	for _, rawURL := range []string{
		"http://tourniquet.app/widgets/alert/AbCdEf0123456789GhIjKlMn",
		"https://tourniquet.app.evil.test/widgets/alert/AbCdEf0123456789GhIjKlMn",
		"https://tourniquet.app/widgets/alert/short",
		"https://tourniquet.app/widgets/alert/AbCdEf0123456789GhIjKlMn/extra",
		"https://tourniquet.app/widgets/alert/AbCdEf0123456789GhIjKlMn?copy=true",
	} {
		if _, err := ParseWidgetURL(rawURL); err == nil {
			t.Fatalf("expected %q to fail", rawURL)
		}
	}
}

func TestParseWidgetURLDoesNotLeakToken(t *testing.T) {
	const token = "PrivateWidgetToken123456"
	_, err := ParseWidgetURL("https://tourniquet.app/widgets/alert/" + token + "%ZZ")
	if err == nil {
		t.Fatal("expected malformed URL to fail")
	}
	if strings.Contains(err.Error(), token) {
		t.Fatalf("parse error leaked token: %v", err)
	}
}

func TestRawDonationPreservesCryptoAssetAndPrecision(t *testing.T) {
	price := scalar("0.000123450000000000")
	author := "Supporter"
	message := "https://youtu.be/_JXL6Fn99l8"
	donation, accepted, err := (rawDonation{
		OrderID:             "transaction-42",
		Username:            &author,
		Text:                &message,
		Amount:              "10",
		Fiat:                "USD",
		MoneyType:           "USDT (TRX)",
		PriceInTokenRounded: &price,
		UpdatedAt:           "2026-09-15 12:34:56",
	}).donation()
	if err != nil {
		t.Fatal(err)
	}
	if !accepted {
		t.Fatal("expected donation to be accepted")
	}
	expectedTime := time.Date(2026, 9, 15, 12, 34, 56, 0, time.UTC)
	if donation.SourceDonationID != "transaction-42" || donation.Amount != "0.00012345" || donation.Currency != "USDT (TRX)" || donation.SourceCreatedAt != "2026-09-15 12:34:56" || !donation.OccurredAt.Equal(expectedTime) {
		t.Fatalf("donation=%#v", donation)
	}
}

func TestRawDonationUsesFiatFields(t *testing.T) {
	donation, accepted, err := (rawDonation{
		OrderID:   "transaction-43",
		Amount:    "25.5",
		Fiat:      "usd",
		MoneyType: "FIAT",
		UpdatedAt: "2026-09-15T12:34:56Z",
	}).donation()
	if err != nil || !accepted {
		t.Fatalf("accepted=%v err=%v", accepted, err)
	}
	if donation.Amount != "25.5" || donation.Currency != "USD" {
		t.Fatalf("donation=%#v", donation)
	}
}

func TestRawDonationIgnoresProviderTestAlert(t *testing.T) {
	_, accepted, err := (rawDonation{Amount: "100", Fiat: "USD"}).donation()
	if err != nil || accepted {
		t.Fatalf("accepted=%v err=%v", accepted, err)
	}
}
