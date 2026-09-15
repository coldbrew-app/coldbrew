package money

import "testing"

func TestConvertWithDefaultRate(t *testing.T) {
	tests := []struct {
		name     string
		amount   string
		from     string
		to       string
		expected string
		ok       bool
	}{
		{name: "rubles to dollars", amount: "90.00", from: "RUB", to: "USD", expected: "1.00", ok: true},
		{name: "euros to dollars rounds", amount: "1.00", from: "EUR", to: "USD", expected: "1.11", ok: true},
		{name: "unsupported source", amount: "1.00", from: "AUD", to: "RUB", ok: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			actual, ok, err := ConvertWithDefaultRate(test.amount, test.from, test.to)
			if err != nil {
				t.Fatal(err)
			}
			if ok != test.ok || actual != test.expected {
				t.Fatalf("ConvertWithDefaultRate() = %q, %v; want %q, %v", actual, ok, test.expected, test.ok)
			}
		})
	}
}

func TestNormalize(t *testing.T) {
	for input, expected := range map[string]string{"90": "90.00", "1.2": "1.20", "0.00": "0.00"} {
		actual, err := Normalize(input)
		if err != nil {
			t.Fatal(err)
		}
		if actual != expected {
			t.Fatalf("Normalize(%q) = %q; want %q", input, actual, expected)
		}
	}
}

func TestNormalizeDonationAmountPreservesProviderPrecision(t *testing.T) {
	for input, expected := range map[string]string{
		"90":                   "90",
		"1.200000000000000000": "1.2",
		"0.000000000000000123": "0.000000000000000123",
	} {
		actual, err := NormalizeDonationAmount(input)
		if err != nil {
			t.Fatal(err)
		}
		if actual != expected {
			t.Fatalf("NormalizeDonationAmount(%q) = %q; want %q", input, actual, expected)
		}
	}
}

func TestNormalizeDonationAmountRejectsUnsupportedPrecision(t *testing.T) {
	for _, input := range []string{"-1", "1.0000000000000000001", "100000000000000000000"} {
		if _, err := NormalizeDonationAmount(input); err == nil {
			t.Fatalf("expected %q to be rejected", input)
		}
	}
}
