package money

import (
	"fmt"
	"math/big"
	"regexp"
	"strings"
)

var (
	amountPattern         = regexp.MustCompile(`^(\d{1,18})(?:\.(\d{1,2}))?$`)
	donationAmountPattern = regexp.MustCompile(`^(\d{1,20})(?:\.(\d{1,18}))?$`)
)

var rublesPerUnit = map[string]int64{
	"RUB": 1,
	"USD": 90,
	"EUR": 100,
}

// Normalize validates a non-negative money amount and formats it with two decimal places.
func Normalize(amount string) (string, error) {
	match := amountPattern.FindStringSubmatch(amount)
	if match == nil {
		return "", fmt.Errorf("invalid money amount %q", amount)
	}
	return match[1] + "." + match[2] + strings.Repeat("0", 2-len(match[2])), nil
}

// NormalizeDonationAmount validates an original donation amount without
// reducing the precision reported by providers that accept crypto assets.
func NormalizeDonationAmount(amount string) (string, error) {
	match := donationAmountPattern.FindStringSubmatch(strings.TrimSpace(amount))
	if match == nil {
		return "", fmt.Errorf("invalid donation amount %q", amount)
	}
	fraction := strings.TrimRight(match[2], "0")
	if fraction == "" {
		return match[1], nil
	}
	return match[1] + "." + fraction, nil
}

// ConvertWithDefaultRate converts a precise original donation amount between
// queue currencies without floating-point arithmetic, then rounds the result
// to two decimal places. The boolean is false when either currency is unsupported.
func ConvertWithDefaultRate(amount, sourceCurrency, targetCurrency string) (string, bool, error) {
	sourceRate, sourceOK := rublesPerUnit[sourceCurrency]
	targetRate, targetOK := rublesPerUnit[targetCurrency]
	if !sourceOK || !targetOK {
		return "", false, nil
	}

	units, scale, err := parseDonationUnits(amount)
	if err != nil {
		return "", false, err
	}
	numerator := new(big.Int).Mul(units, big.NewInt(sourceRate))
	numerator.Mul(numerator, big.NewInt(100))
	denominator := new(big.Int).Mul(scale, big.NewInt(targetRate))
	converted := roundDiv(numerator, denominator)
	return formatCents(converted), true, nil
}

func parseDonationUnits(amount string) (*big.Int, *big.Int, error) {
	normalized, err := NormalizeDonationAmount(amount)
	if err != nil {
		return nil, nil, err
	}
	whole, fraction, _ := strings.Cut(normalized, ".")
	value := new(big.Int)
	if _, ok := value.SetString(whole+fraction, 10); !ok {
		return nil, nil, fmt.Errorf("parse donation amount %q", amount)
	}
	scale := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(len(fraction))), nil)
	return value, scale, nil
}

func roundDiv(numerator, denominator *big.Int) *big.Int {
	adjusted := new(big.Int).Add(numerator, new(big.Int).Div(denominator, big.NewInt(2)))
	return adjusted.Div(adjusted, denominator)
}

func formatCents(value *big.Int) string {
	whole := new(big.Int).Div(new(big.Int).Set(value), big.NewInt(100))
	fraction := new(big.Int).Mod(new(big.Int).Set(value), big.NewInt(100))
	return fmt.Sprintf("%s.%02d", whole.String(), fraction.Int64())
}
