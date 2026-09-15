package streamelements

import (
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

	"github.com/streambrew-app/streambrew/internal/money"
)

const (
	defaultBaseURL     = "https://api.streamelements.com"
	historyPageSize    = 100
	maximumHistoryPage = 1000
	oauthScopes        = "channel:read tips:read"
)

var currencyPattern = regexp.MustCompile(`^[A-Z]{3}$`)

// Config contains the OAuth application credentials used for StreamElements.
type Config struct {
	ClientID     string
	ClientSecret string
}

// Tokens are the rotating credentials returned by StreamElements OAuth.
type Tokens struct {
	AccessToken  string
	RefreshToken string
}

// Connection is the authenticated StreamElements channel and its credentials.
type Connection struct {
	Tokens
	SourceUserID string
}

// Donation is a completed StreamElements tip with its original amount and currency.
type Donation struct {
	SourceDonationID string
	Author           *string
	Message          *string
	Amount           string
	Currency         string
	SourceCreatedAt  string
	OccurredAt       time.Time
}

// History is a newest-first page traversal result and its next checkpoint.
type History struct {
	Donations  []Donation
	Checkpoint *string
}

// RequestError classifies failures at a StreamElements boundary.
type RequestError struct {
	Unauthorized bool
	// Authorized reports that this listener Run had already confirmed an Astro
	// subscription before the credentials were rejected.
	Authorized bool
	Permanent  bool
	Status     int
	Operation  string
	Cause      error
}

func (err *RequestError) Error() string {
	if err.Status != 0 {
		return fmt.Sprintf("streamelements: %s returned HTTP %d", err.Operation, err.Status)
	}
	return fmt.Sprintf("streamelements: %s: %v", err.Operation, err.Cause)
}

func (err *RequestError) Unwrap() error { return err.Cause }

// HadAuthorizedSession reports whether this listener Run subscribed before failing.
func (err *RequestError) HadAuthorizedSession() bool { return err.Authorized }

// Client calls the StreamElements OAuth and Kappa APIs.
type Client struct {
	HTTPClient *http.Client
	BaseURL    string
	PageDelay  time.Duration
	now        func() time.Time
}

func NewClient(httpClient *http.Client) *Client {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	return &Client{
		HTTPClient: httpClient,
		BaseURL:    defaultBaseURL,
		PageDelay:  250 * time.Millisecond,
		now:        time.Now,
	}
}

func AuthorizationURL(clientID, redirectURI, state string) string {
	parameters := url.Values{
		"client_id":     {clientID},
		"redirect_uri":  {redirectURI},
		"response_type": {"code"},
		"scope":         {oauthScopes},
		"state":         {state},
	}
	return defaultBaseURL + "/oauth2/authorize?" + parameters.Encode()
}

func (client *Client) IssueConnection(
	ctx context.Context,
	config Config,
	authCode string,
	redirectURI string,
) (Connection, error) {
	tokens, err := client.fetchTokens(ctx, url.Values{
		"grant_type":    {"authorization_code"},
		"client_id":     {config.ClientID},
		"client_secret": {config.ClientSecret},
		"code":          {authCode},
		"redirect_uri":  {redirectURI},
	})
	if err != nil {
		return Connection{}, err
	}

	var profile struct {
		ID string `json:"_id"`
	}
	if err := client.doJSON(ctx, http.MethodGet, "/kappa/v2/channels/me", nil, "", tokens.AccessToken, &profile); err != nil {
		return Connection{}, err
	}
	channelID := strings.TrimSpace(profile.ID)
	if channelID == "" {
		return Connection{}, requestValidationError("read channel profile", errors.New("missing channel id"))
	}
	return Connection{Tokens: tokens, SourceUserID: channelID}, nil
}

func (client *Client) RefreshTokens(ctx context.Context, config Config, refreshToken string) (Tokens, error) {
	return client.fetchTokens(ctx, url.Values{
		"grant_type":    {"refresh_token"},
		"client_id":     {config.ClientID},
		"client_secret": {config.ClientSecret},
		"refresh_token": {refreshToken},
	})
}

// GetDonations walks the complete stable tips range from newest to oldest.
// Only an initial unbounded traversal returns a checkpoint. Replays return no
// checkpoint so a concurrent recovery cannot replace the initial history head.
func (client *Client) GetDonations(
	ctx context.Context,
	accessToken string,
	channelID string,
	checkpoint *string,
	occurredAfter *time.Time,
) (History, error) {
	channelID = strings.TrimSpace(channelID)
	if channelID == "" {
		return History{}, permanentRequestError("read tips", errors.New("missing channel id"))
	}

	donations := make([]Donation, 0)
	var newCheckpoint *string
	initialTraversal := checkpoint == nil && occurredAfter == nil
	offset := 0
	syncStartedAt := client.now().UTC().Format(time.RFC3339Nano)

	for pageNumber := 1; pageNumber <= maximumHistoryPage; pageNumber++ {
		if pageNumber > 1 {
			if err := waitContext(ctx, client.PageDelay); err != nil {
				return History{}, err
			}
		}

		parameters := url.Values{
			"before": {syncStartedAt},
			"limit":  {strconv.Itoa(historyPageSize)},
			"offset": {strconv.Itoa(offset)},
			"sort":   {"-createdAt"},
			"tz":     {"0"},
		}
		if occurredAfter != nil {
			parameters.Set("after", occurredAfter.UTC().Format(time.RFC3339Nano))
		}
		path := "/kappa/v2/tips/" + url.PathEscape(channelID) + "?" + parameters.Encode()
		var page tipsPage
		if err := client.doJSON(ctx, http.MethodGet, path, nil, "", accessToken, &page); err != nil {
			return History{}, err
		}
		if len(page.Docs) == 0 {
			return History{Donations: donations, Checkpoint: newCheckpoint}, nil
		}

		if initialTraversal && newCheckpoint == nil {
			if page.Docs[0].ID == "" {
				return History{}, permanentRequestError("read tips", errors.New("missing tip id"))
			}
			head := page.Docs[0].ID
			newCheckpoint = &head
		}

		for _, raw := range page.Docs {
			if raw.ID == "" {
				return History{}, permanentRequestError("read tips", errors.New("missing tip id"))
			}
			donation, err := raw.donation(channelID)
			if err != nil {
				return History{}, permanentRequestError("read tips", err)
			}
			donations = append(donations, donation)
		}

		offset += len(page.Docs)
		if page.last(offset, pageNumber) {
			return History{Donations: donations, Checkpoint: newCheckpoint}, nil
		}
	}
	return History{}, permanentRequestError("read tips", errors.New("history exceeds pagination safety limit"))
}

type tipsPage struct {
	Docs        []rawTip `json:"docs"`
	Total       *int     `json:"total"`
	TotalDocs   *int     `json:"totalDocs"`
	TotalPages  *int     `json:"totalPages"`
	HasNextPage *bool    `json:"hasNextPage"`
}

func (page tipsPage) last(offset, pageNumber int) bool {
	if page.HasNextPage != nil {
		return !*page.HasNextPage
	}
	if page.TotalDocs != nil {
		return offset >= *page.TotalDocs
	}
	if page.Total != nil {
		return offset >= *page.Total
	}
	if page.TotalPages != nil {
		return pageNumber >= *page.TotalPages
	}
	return len(page.Docs) < historyPageSize
}

type rawTip struct {
	ID       string `json:"_id"`
	Channel  string `json:"channel"`
	Provider string `json:"provider"`
	Approved string `json:"approved"`
	Status   string `json:"status"`
	Deleted  bool   `json:"deleted"`
	Donation struct {
		User struct {
			Username *string `json:"username"`
		} `json:"user"`
		Message  *string        `json:"message"`
		Amount   stringOrNumber `json:"amount"`
		Currency string         `json:"currency"`
	} `json:"donation"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

func (tip rawTip) donation(channelID string) (Donation, error) {
	if tip.ID == "" || tip.Channel != channelID {
		return Donation{}, errors.New("invalid tip identity or channel")
	}
	currency := strings.ToUpper(strings.TrimSpace(tip.Donation.Currency))
	if !currencyPattern.MatchString(currency) {
		return Donation{}, errors.New("invalid tip currency")
	}
	amount, err := money.Normalize(string(tip.Donation.Amount))
	if err != nil {
		return Donation{}, err
	}
	occurredAt, err := time.Parse(time.RFC3339Nano, tip.CreatedAt)
	if err != nil {
		return Donation{}, errors.New("invalid tip date")
	}
	return Donation{
		SourceDonationID: tip.ID,
		Author:           tip.Donation.User.Username,
		Message:          tip.Donation.Message,
		Amount:           amount,
		Currency:         currency,
		SourceCreatedAt:  tip.CreatedAt,
		OccurredAt:       occurredAt.UTC(),
	}, nil
}

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

func (client *Client) fetchTokens(ctx context.Context, values url.Values) (Tokens, error) {
	var payload struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
	}
	if err := client.doJSON(
		ctx,
		http.MethodPost,
		"/oauth2/token",
		strings.NewReader(values.Encode()),
		"application/x-www-form-urlencoded",
		"",
		&payload,
	); err != nil {
		return Tokens{}, err
	}
	if payload.AccessToken == "" || payload.RefreshToken == "" {
		return Tokens{}, requestValidationError("fetch tokens", errors.New("missing token"))
	}
	return Tokens{AccessToken: payload.AccessToken, RefreshToken: payload.RefreshToken}, nil
}

func (client *Client) doJSON(
	ctx context.Context,
	method string,
	path string,
	body io.Reader,
	contentType string,
	accessToken string,
	target any,
) error {
	request, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(client.BaseURL, "/")+path, body)
	if err != nil {
		return &RequestError{Operation: method + " " + path, Cause: err}
	}
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	if accessToken != "" {
		request.Header.Set("Authorization", "OAuth "+accessToken)
	}
	response, err := client.HTTPClient.Do(request)
	if err != nil {
		return &RequestError{Operation: method + " " + path, Cause: err}
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		unauthorized := response.StatusCode == http.StatusUnauthorized
		if response.StatusCode == http.StatusBadRequest && path == "/oauth2/token" {
			unauthorized = tokenGrantInvalid(response.Body)
		}
		return &RequestError{
			Unauthorized: unauthorized,
			Permanent: response.StatusCode >= http.StatusBadRequest &&
				response.StatusCode < http.StatusInternalServerError &&
				response.StatusCode != http.StatusRequestTimeout &&
				response.StatusCode != http.StatusTooManyRequests &&
				!unauthorized,
			Status:    response.StatusCode,
			Operation: method + " " + path,
		}
	}
	decoder := json.NewDecoder(response.Body)
	decoder.UseNumber()
	if err := decoder.Decode(target); err != nil {
		return requestValidationError(method+" "+path, err)
	}
	return nil
}

func tokenGrantInvalid(body io.Reader) bool {
	var oauthError struct {
		Error string `json:"error"`
	}
	// OAuth error bodies are small; the bound also prevents an unexpected response from being buffered.
	decoder := json.NewDecoder(io.LimitReader(body, 4096))
	return decoder.Decode(&oauthError) == nil && oauthError.Error == "invalid_grant"
}

func requestValidationError(operation string, cause error) error {
	return &RequestError{Operation: operation, Cause: cause}
}

func permanentRequestError(operation string, cause error) error {
	return &RequestError{Permanent: true, Operation: operation, Cause: cause}
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
