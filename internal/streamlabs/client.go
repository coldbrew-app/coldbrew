package streamlabs

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/lebedev-nikita/coldbrew/internal/money"
)

const (
	defaultBaseURL     = "https://streamlabs.com/api/v2.0"
	historyPageSize    = 100
	maximumHistoryPage = 1000
)

var scopes = []string{"donations.read", "socket.token"}
var currencyPattern = regexp.MustCompile(`^[A-Z]{3}$`)

type stringOrNumber string

func (value *stringOrNumber) UnmarshalJSON(body []byte) error {
	if len(body) == 0 {
		return errors.New("empty scalar")
	}
	if body[0] == '"' {
		var text string
		if err := json.Unmarshal(body, &text); err != nil {
			return err
		}
		*value = stringOrNumber(text)
		return nil
	}
	var number json.Number
	if err := json.Unmarshal(body, &number); err != nil {
		return err
	}
	*value = stringOrNumber(number.String())
	return nil
}

type Config struct {
	ClientID     string
	ClientSecret string
	RedirectURI  string
}

type Tokens struct {
	AccessToken  string
	RefreshToken string
}

type Connection struct {
	Tokens
	SourceUserID string
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

type History struct {
	Donations  []Donation
	Checkpoint *string
}

type RequestError struct {
	Unauthorized bool
	Status       int
	Operation    string
	Cause        error
}

func (e *RequestError) Error() string {
	if e.Status != 0 {
		return fmt.Sprintf("streamlabs: %s returned HTTP %d", e.Operation, e.Status)
	}
	return fmt.Sprintf("streamlabs: %s: %v", e.Operation, e.Cause)
}

func (e *RequestError) Unwrap() error { return e.Cause }

type Client struct {
	HTTPClient *http.Client
	BaseURL    string
	PageDelay  time.Duration
}

func NewClient(httpClient *http.Client) *Client {
	return &Client{HTTPClient: httpClient, BaseURL: defaultBaseURL, PageDelay: 250 * time.Millisecond}
}

func AuthorizationURL(clientID, redirectURI, state string) string {
	parameters := url.Values{
		"client_id":     {clientID},
		"redirect_uri":  {redirectURI},
		"response_type": {"code"},
		"scope":         {strings.Join(scopes, " ")},
		"state":         {state},
	}
	return defaultBaseURL + "/authorize?" + parameters.Encode()
}

func (client *Client) IssueConnection(ctx context.Context, config Config, authCode, redirectURI string) (Connection, error) {
	tokens, err := client.fetchTokens(ctx, map[string]string{
		"grant_type":    "authorization_code",
		"client_id":     config.ClientID,
		"client_secret": config.ClientSecret,
		"redirect_uri":  redirectURI,
		"code":          authCode,
	})
	if err != nil {
		return Connection{}, err
	}
	var profile struct {
		Streamlabs struct {
			ID stringOrNumber `json:"id"`
		} `json:"streamlabs"`
	}
	if err := client.doJSON(ctx, http.MethodGet, "/user", nil, tokens.AccessToken, &profile); err != nil {
		return Connection{}, err
	}
	if profile.Streamlabs.ID == "" {
		return Connection{}, requestValidationError("read profile", errors.New("missing Streamlabs user id"))
	}
	return Connection{Tokens: tokens, SourceUserID: string(profile.Streamlabs.ID)}, nil
}

func (client *Client) RefreshTokens(ctx context.Context, config Config, refreshToken string) (Tokens, error) {
	return client.fetchTokens(ctx, map[string]string{
		"grant_type":    "refresh_token",
		"client_id":     config.ClientID,
		"client_secret": config.ClientSecret,
		"redirect_uri":  config.RedirectURI,
		"refresh_token": refreshToken,
	})
}

func (client *Client) GetDonations(ctx context.Context, accessToken string, checkpoint *string) (History, error) {
	donations := make([]Donation, 0)
	seenCursors := make(map[string]struct{})
	var before string
	var newCheckpoint *string

	for pageNumber := 1; pageNumber <= maximumHistoryPage; pageNumber++ {
		if pageNumber > 1 {
			if err := waitContext(ctx, client.PageDelay); err != nil {
				return History{}, err
			}
		}
		parameters := url.Values{"limit": {strconv.Itoa(historyPageSize)}}
		if before != "" {
			parameters.Set("before", before)
		}
		var page struct {
			Data []rawDonation `json:"data"`
		}
		path := "/donations?" + parameters.Encode()
		if err := client.doJSON(ctx, http.MethodGet, path, nil, accessToken, &page); err != nil {
			return History{}, err
		}
		if len(page.Data) == 0 {
			return History{Donations: donations, Checkpoint: checkpointOrNew(checkpoint, newCheckpoint)}, nil
		}
		if newCheckpoint == nil {
			head := string(page.Data[0].DonationID)
			if head == "" {
				return History{}, requestValidationError("read donations", errors.New("missing donation id"))
			}
			newCheckpoint = &head
		}
		for _, raw := range page.Data {
			if checkpoint != nil && string(raw.DonationID) == *checkpoint {
				return History{Donations: donations, Checkpoint: newCheckpoint}, nil
			}
			donation, err := raw.donation()
			if err != nil {
				return History{}, requestValidationError("read donations", err)
			}
			donations = append(donations, donation)
		}
		before = string(page.Data[len(page.Data)-1].DonationID)
		if before == "" {
			return History{}, requestValidationError("read donations", errors.New("missing pagination cursor"))
		}
		if _, exists := seenCursors[before]; exists {
			return History{}, requestValidationError("read donations", errors.New("repeated pagination cursor"))
		}
		seenCursors[before] = struct{}{}
	}
	return History{}, requestValidationError("read donations", errors.New("history exceeds pagination safety limit"))
}

func checkpointOrNew(checkpoint, next *string) *string {
	if next != nil {
		return next
	}
	return checkpoint
}

func (client *Client) SocketToken(ctx context.Context, accessToken string) (string, error) {
	var payload struct {
		SocketToken string `json:"socket_token"`
	}
	if err := client.doJSON(ctx, http.MethodGet, "/socket/token", nil, accessToken, &payload); err != nil {
		return "", err
	}
	if payload.SocketToken == "" {
		return "", requestValidationError("read socket token", errors.New("missing socket token"))
	}
	return payload.SocketToken, nil
}

type rawDonation struct {
	DonationID stringOrNumber `json:"donation_id"`
	CreatedAt  stringOrNumber `json:"created_at"`
	Currency   string         `json:"currency"`
	Amount     stringOrNumber `json:"amount"`
	Name       *string        `json:"name"`
	Message    *string        `json:"message"`
}

func (raw rawDonation) donation() (Donation, error) {
	if raw.DonationID == "" || !currencyPattern.MatchString(raw.Currency) {
		return Donation{}, errors.New("invalid donation identity or currency")
	}
	amount, err := money.Normalize(string(raw.Amount))
	if err != nil {
		return Donation{}, err
	}
	unixSeconds, err := strconv.ParseInt(string(raw.CreatedAt), 10, 64)
	if err != nil || unixSeconds < 0 {
		return Donation{}, errors.New("invalid donation date")
	}
	return Donation{
		SourceDonationID: string(raw.DonationID),
		Author:           raw.Name,
		Message:          raw.Message,
		Amount:           amount,
		Currency:         raw.Currency,
		SourceCreatedAt:  string(raw.CreatedAt),
		OccurredAt:       time.Unix(unixSeconds, 0).UTC(),
	}, nil
}

func (client *Client) fetchTokens(ctx context.Context, values map[string]string) (Tokens, error) {
	body, err := json.Marshal(values)
	if err != nil {
		return Tokens{}, requestValidationError("encode token request", err)
	}
	var payload struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
	}
	if err := client.doJSON(ctx, http.MethodPost, "/token", bytes.NewReader(body), "", &payload); err != nil {
		return Tokens{}, err
	}
	if payload.AccessToken == "" || payload.RefreshToken == "" {
		return Tokens{}, requestValidationError("fetch tokens", errors.New("missing token"))
	}
	return Tokens{AccessToken: payload.AccessToken, RefreshToken: payload.RefreshToken}, nil
}

func (client *Client) doJSON(ctx context.Context, method, path string, body io.Reader, accessToken string, target any) error {
	request, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(client.BaseURL, "/")+path, body)
	if err != nil {
		return &RequestError{Operation: method + " " + path, Cause: err}
	}
	if accessToken != "" {
		request.Header.Set("Authorization", "Bearer "+accessToken)
	}
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("X-Requested-With", "XMLHttpRequest")
	}
	response, err := client.HTTPClient.Do(request)
	if err != nil {
		return &RequestError{Operation: method + " " + path, Cause: err}
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return &RequestError{
			Unauthorized: response.StatusCode == http.StatusUnauthorized,
			Status:       response.StatusCode,
			Operation:    method + " " + path,
		}
	}
	decoder := json.NewDecoder(response.Body)
	decoder.UseNumber()
	if err := decoder.Decode(target); err != nil {
		return requestValidationError(method+" "+path, err)
	}
	return nil
}

func requestValidationError(operation string, cause error) error {
	return &RequestError{Operation: operation, Cause: cause}
}

func waitContext(ctx context.Context, duration time.Duration) error {
	if duration <= 0 {
		return nil
	}
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
