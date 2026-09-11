package donatestream

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/lebedev-nikita/coldbrew/internal/money"
)

const (
	widgetHost = "donate.stream"
	widgetPath = "/widget-alert"
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
	WidgetGroupUID string
	WidgetToken    string
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
	Unauthorized bool
	Operation    string
	Cause        error
}

func (e *RequestError) Error() string {
	return fmt.Sprintf("donate.stream: %s: %v", e.Operation, e.Cause)
}

func (e *RequestError) Unwrap() error { return e.Cause }

func ParseWidgetURL(rawURL string) (Connection, error) {
	parsed, err := url.ParseRequestURI(strings.TrimSpace(rawURL))
	if err != nil {
		return Connection{}, invalidWidgetURL(err)
	}
	if parsed.Scheme != "https" || parsed.Hostname() != widgetHost || parsed.Port() != "" || parsed.User != nil || strings.TrimSuffix(parsed.Path, "/") != widgetPath || parsed.Fragment != "" {
		return Connection{}, invalidWidgetURL(errors.New("unexpected widget URL origin or path"))
	}
	query := parsed.Query()
	groupUIDs := query["uid"]
	tokens := query["token"]
	if len(groupUIDs) != 1 || len(tokens) != 1 {
		return Connection{}, invalidWidgetURL(errors.New("widget URL must contain one uid and one token"))
	}
	groupUID := strings.TrimSpace(groupUIDs[0])
	token := strings.TrimSpace(tokens[0])
	if groupUID == "" || len(groupUID) > 200 || len(token) < 16 || len(token) > 4096 {
		return Connection{}, invalidWidgetURL(errors.New("invalid widget uid or token"))
	}
	return Connection{WidgetGroupUID: groupUID, WidgetToken: token}, nil
}

type rawAlert struct {
	MessageUID scalar  `json:"message_uid"`
	Nickname   *string `json:"nickname"`
	Message    *string `json:"message"`
	Sum        scalar  `json:"sum"`
	Currency   string  `json:"currency"`
}

func (raw rawAlert) donation(receivedAt time.Time) (Donation, error) {
	if raw.MessageUID == "" {
		return Donation{}, errors.New("missing message_uid")
	}
	amount, err := money.Normalize(string(raw.Sum))
	if err != nil {
		return Donation{}, fmt.Errorf("invalid donation amount: %w", err)
	}
	currency := strings.ToUpper(strings.TrimSpace(raw.Currency))
	if currency == "" {
		currency = "RUB"
	}
	if len(currency) != 3 || strings.IndexFunc(currency, func(value rune) bool { return value < 'A' || value > 'Z' }) != -1 {
		return Donation{}, fmt.Errorf("invalid donation currency %q", raw.Currency)
	}
	receivedAt = receivedAt.UTC()
	return Donation{
		SourceDonationID: string(raw.MessageUID),
		Author:           raw.Nickname,
		Message:          raw.Message,
		Amount:           amount,
		Currency:         currency,
		SourceCreatedAt:  receivedAt.Format(time.RFC3339Nano),
		OccurredAt:       receivedAt,
	}, nil
}

func invalidWidgetURL(cause error) error {
	return &RequestError{InvalidInput: true, Operation: "parse widget URL", Cause: cause}
}
