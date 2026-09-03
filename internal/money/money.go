package money

import (
	"fmt"
	"math/big"
	"regexp"
	"strings"
)

var amountPattern = regexp.MustCompile(`^(\d{1,18})(?:\.(\d{1,2}))?$`)

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

// ConvertWithDefaultRate converts between the queue currencies without floating-point arithmetic.
// The boolean is false when the source or target currency is unsupported.
func ConvertWithDefaultRate(amount, sourceCurrency, targetCurrency string) (string, bool, error) {
	sourceRate, sourceOK := rublesPerUnit[sourceCurrency]
	targetRate, targetOK := rublesPerUnit[targetCurrency]
	if !sourceOK || !targetOK {
		return "", false, nil
	}

	cents, err := parseCents(amount)
	if err != nil {
		return "", false, err
	}
	numerator := new(big.Int).Mul(cents, big.NewInt(sourceRate))
	converted := roundDiv(numerator, big.NewInt(targetRate))
	return formatCents(converted), true, nil
}

func parseCents(amount string) (*big.Int, error) {
	normalized, err := Normalize(amount)
	if err != nil {
		return nil, err
	}
	value := new(big.Int)
	if _, ok := value.SetString(strings.Replace(normalized, ".", "", 1), 10); !ok {
		return nil, fmt.Errorf("parse money amount %q", amount)
	}
	return value, nil
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
