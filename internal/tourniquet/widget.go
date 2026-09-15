package tourniquet

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/streambrew-app/streambrew/internal/money"
)

const (
	widgetHost       = "tourniquet.app"
	widgetPathPrefix = "/widgets/alert/"
)

var (
	widgetTokenPattern = regexp.MustCompile(`^[A-Za-z0-9]{16,200}$`)
	assetPattern       = regexp.MustCompile(`^[A-Z0-9][-A-Z0-9 ._()/+]{0,31}$`)
)

type scalar string

func (value *scalar) UnmarshalJSON(body []byte) error {
	if len(body) == 0 || bytes.Equal(body, []byte("null")) {
		return errors.New("empty scalar")
	}
	if body[0] == '"' {
		var text string
		if err := json.Unmarshal(body, &text); err != nil {
			return err
		}
		*value = scalar(text)
		return nil
	}
	var number json.Number
	if err := json.Unmarshal(body, &number); err != nil {
		return err
	}
	*value = scalar(number.String())
	return nil
}

type Connection struct {
	WidgetToken string
}

type Donation struct {
	SourceDonationID string
	Author           *string
	Message          *string
	Amount           string
	Currency         string
	SourceCreatedAt  string
	OccurredAt       time.Time
}

type RequestError struct {
	InvalidInput bool
	Operation    string
	Cause        error
}

func (err *RequestError) Error() string {
	return fmt.Sprintf("Tourniquet: %s: %v", err.Operation, err.Cause)
}

func (err *RequestError) Unwrap() error { return err.Cause }

func ParseWidgetURL(rawURL string) (Connection, error) {
	parsed, err := url.ParseRequestURI(strings.TrimSpace(rawURL))
	if err != nil {
		return Connection{}, invalidWidgetURL(errors.New("malformed widget URL"))
	}
	if parsed.Scheme != "https" || parsed.Hostname() != widgetHost || parsed.Port() != "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return Connection{}, invalidWidgetURL(errors.New("unexpected widget URL origin"))
	}
	token := strings.TrimPrefix(parsed.EscapedPath(), widgetPathPrefix)
	if token == parsed.EscapedPath() || strings.Contains(token, "/") {
		return Connection{}, invalidWidgetURL(errors.New("unexpected widget URL path"))
	}
	decodedToken, err := url.PathUnescape(token)
	if err != nil || !widgetTokenPattern.MatchString(decodedToken) {
		return Connection{}, invalidWidgetURL(errors.New("invalid widget token"))
	}
	return Connection{WidgetToken: decodedToken}, nil
}

type rawDonation struct {
	OrderID             scalar  `json:"order_id"`
	Username            *string `json:"username"`
	Text                *string `json:"text"`
	Amount              scalar  `json:"amount"`
	Fiat                string  `json:"fiat"`
	MoneyType           string  `json:"money_type"`
	PriceInTokenRounded *scalar `json:"price_in_token_rounded"`
	UpdatedAt           string  `json:"updated_at"`
}

func (raw rawDonation) donation() (Donation, bool, error) {
	if raw.OrderID == "" {
		// Tourniquet's dashboard test alert intentionally has no transaction
		// reference. It previews the provider widget and is not a donation.
		return Donation{}, false, nil
	}
	amountInput := string(raw.Amount)
	currencyInput := raw.Fiat
	moneyType := strings.ToUpper(strings.TrimSpace(raw.MoneyType))
	if raw.PriceInTokenRounded != nil && moneyType != "" && moneyType != "FIAT" {
		amountInput = string(*raw.PriceInTokenRounded)
		currencyInput = moneyType
	}
	amount, err := money.NormalizeDonationAmount(amountInput)
	if err != nil {
		return Donation{}, false, fmt.Errorf("invalid donation amount: %w", err)
	}
	currency := strings.ToUpper(strings.TrimSpace(currencyInput))
	if !assetPattern.MatchString(currency) {
		return Donation{}, false, errors.New("invalid donation asset")
	}
	occurredAt, err := parseSourceTime(raw.UpdatedAt)
	if err != nil {
		return Donation{}, false, err
	}
	return Donation{
		SourceDonationID: string(raw.OrderID),
		Author:           raw.Username,
		Message:          raw.Text,
		Amount:           amount,
		Currency:         currency,
		SourceCreatedAt:  raw.UpdatedAt,
		OccurredAt:       occurredAt,
	}, true, nil
}

func parseSourceTime(value string) (time.Time, error) {
	trimmed := strings.TrimSpace(value)
	for _, layout := range []string{"2006-01-02 15:04:05", time.RFC3339Nano} {
		parsed, err := time.ParseInLocation(layout, trimmed, time.UTC)
		if err == nil {
			return parsed.UTC(), nil
		}
	}
	return time.Time{}, errors.New("invalid donation timestamp")
}

func invalidWidgetURL(cause error) error {
	return &RequestError{InvalidInput: true, Operation: "parse widget URL", Cause: cause}
}
