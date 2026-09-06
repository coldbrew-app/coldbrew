package chat

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// BoostyProvider is an unofficial, read-only client for Boosty's web chat API.
// Protocol references and limitations are recorded in docs/boosty.md.
type BoostyProvider struct {
	client *http.Client
	apiURL string
	wait   func(context.Context, time.Duration) bool
}

func NewBoostyProvider(client *http.Client) *BoostyProvider {
	return &BoostyProvider{client: client, apiURL: "https://api.boosty.to", wait: waitFor}
}
func (*BoostyProvider) Name() string       { return "boosty" }
func (*BoostyProvider) Collection() string { return "pull" }

var boostyBlogPattern = regexp.MustCompile(`^[a-z0-9_][a-z0-9_.-]{0,99}$`)

type boostyUser struct {
	ID      stringOrNumber `json:"id"`
	Name    string         `json:"name"`
	BlogURL string         `json:"blogUrl"`
}

func (provider *BoostyProvider) request(ctx context.Context, token, path string, target any) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, provider.apiURL+path, nil)
	if err != nil {
		return operationError("Could not read Boosty chat", err)
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Accept", "application/json")
	response, err := provider.client.Do(request)
	if err != nil {
		return operationError("Could not read Boosty chat", err)
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNoContent {
		return nil
	}
	if response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden {
		return &ProviderError{Type: "provider unauthorized", Detail: "Reconnect Boosty with a current token that has access to this stream", Cause: &ProviderHTTPError{Status: response.StatusCode}}
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return operationError("Could not read Boosty chat", &ProviderHTTPError{Status: response.StatusCode})
	}
	if err := json.NewDecoder(http.MaxBytesReader(nil, response.Body, 2<<20)).Decode(target); err != nil {
		return operationError("Boosty returned an invalid response", err)
	}
	return nil
}

type BoostyConnectionStore interface {
	HasSourceCapacity(context.Context, int, string, string) (bool, error)
	SaveProviderAccount(context.Context, int, SaveConnection, SaveSource) (string, error)
}

type BoostyConnector struct {
	provider *BoostyProvider
	store    BoostyConnectionStore
}

func NewBoostyConnector(provider *BoostyProvider, store BoostyConnectionStore) *BoostyConnector {
	return &BoostyConnector{provider: provider, store: store}
}

type BoostyCredentials struct {
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
	DeviceID     string `json:"deviceId"`
}

// Connect derives the owned blog from the authenticated identity, never a supplied URL.
func (connector *BoostyConnector) Connect(ctx context.Context, userID int, input BoostyCredentials) error {
	token := strings.TrimSpace(input.AccessToken)
	refreshToken := strings.TrimSpace(input.RefreshToken)
	deviceID := strings.TrimSpace(input.DeviceID)
	if (refreshToken == "") != (deviceID == "") || len(refreshToken) > 8192 || len(deviceID) > 200 || strings.IndexFunc(refreshToken+deviceID, func(r rune) bool { return r <= 32 || r >= 127 }) >= 0 {
		return &ApplicationError{Type: "invalid boosty credentials", Detail: "Provide both the Boosty refresh token and device ID"}
	}
	if token == "" || len(token) > 8192 || strings.IndexFunc(token, func(r rune) bool { return r <= 32 || r >= 127 }) >= 0 {
		return &ApplicationError{Type: "invalid boosty token", Detail: "Invalid Boosty access token"}
	}
	var identity boostyUser
	if err := connector.provider.request(ctx, token, "/v1/user/current", &identity); err != nil {
		return err
	}
	blog := strings.ToLower(strings.TrimSpace(identity.BlogURL))
	if identity.ID == "" || len([]rune(identity.Name)) > 200 || strings.TrimSpace(identity.Name) == "" || !boostyBlogPattern.MatchString(blog) {
		return &ApplicationError{Type: "invalid boosty account", Detail: "The Boosty account must own a blog"}
	}
	var profile struct {
		Owner boostyUser `json:"owner"`
	}
	if err := connector.provider.request(ctx, token, "/v1/blog/"+url.PathEscape(blog), &profile); err != nil {
		return err
	}
	if profile.Owner.ID != identity.ID {
		return &ApplicationError{Type: "invalid boosty account", Detail: "The Boosty account does not own this blog"}
	}
	capacity, err := connector.store.HasSourceCapacity(ctx, userID, "boosty", blog)
	if err != nil {
		return err
	}
	if !capacity {
		return &ApplicationError{Type: "chat source limit reached", Detail: "Chat source limit reached"}
	}
	_, err = connector.store.SaveProviderAccount(ctx, userID, SaveConnection{Provider: "boosty", ProviderUserID: string(identity.ID), DisplayName: identity.Name, AccessToken: token, RefreshToken: refreshToken, OAuthDeviceID: deviceID, Scopes: []string{}}, SaveSource{Provider: "boosty", ProviderSourceID: blog, DisplayName: identity.Name, SourceURL: "https://boosty.to/" + blog + "/streams/video_stream"})
	return err
}

type boostyMessage struct {
	ID              stringOrNumber `json:"id"`
	Author          boostyUser     `json:"author"`
	CreatedAt       int64          `json:"createdAt"`
	IsSystemMessage bool           `json:"isSystemMessage"`
	Data            []struct {
		Type        string `json:"type"`
		Content     string `json:"content"`
		Modificator string `json:"modificator"`
	} `json:"data"`
}

type boostyChatPage struct {
	Data  []boostyMessage `json:"data"`
	Extra *struct {
		Offset string `json:"offset"`
		IsLast bool   `json:"isLast"`
	} `json:"extra"`
}

func (message boostyMessage) normalize(source Source) (Message, bool) {
	if message.IsSystemMessage || message.ID == "" || message.Author.ID == "" || message.CreatedAt <= 0 {
		return Message{}, false
	}
	var text strings.Builder
	for _, block := range message.Data {
		if block.Type != "text" && block.Type != "link" {
			continue
		}
		if block.Modificator == "BLOCK_END" {
			text.WriteByte('\n')
			continue
		}
		content := block.Content
		// Rich-text text blocks carry a JSON tuple whose first element is plain text.
		if strings.HasPrefix(content, "[") {
			var tuple []json.RawMessage
			if json.Unmarshal([]byte(content), &tuple) == nil && len(tuple) > 0 {
				var plain string
				if json.Unmarshal(tuple[0], &plain) == nil {
					content = plain
				}
			}
		}
		text.WriteString(content)
	}
	body := strings.TrimSpace(text.String())
	if body == "" {
		return Message{}, false
	}
	name := strings.TrimSpace(message.Author.Name)
	if name == "" {
		name = string(message.Author.ID)
	}
	if len([]rune(name)) > 200 {
		name = string([]rune(name)[:200])
	}
	return Message{ID: string(message.ID), SourceID: source.SourceID, ConnectionID: source.ConnectionID, Provider: "boosty", Author: Author{ID: string(message.Author.ID), DisplayName: name}, Text: body, OccurredAt: time.Unix(message.CreatedAt, 0).UTC()}, true
}

func (provider *BoostyProvider) Stream(ctx context.Context, source ConnectedSource) (<-chan StreamEvent, <-chan error) {
	events := make(chan StreamEvent)
	failures := make(chan error)
	go func() {
		defer close(events)
		defer close(failures)
		if source.Credentials.AccessToken == "" || !boostyBlogPattern.MatchString(source.Source.ProviderSourceID) {
			sendProviderError(ctx, failures, &ProviderError{Type: "provider unauthorized", Detail: "Reconnect the Boosty account with a current access token"})
			return
		}
		path := "/v1/blog/" + url.PathEscape(source.Source.ProviderSourceID) + "/video_stream"
		lastID := ""
		initialized := false
		highWater := int64(0)
		seen := make(map[string]bool)
		retry := 5 * time.Second
		state := ""
		setState := func(next string) {
			if state != next {
				state = next
				sendStreamEvent(ctx, events, StreamEvent{Type: "state", SourceID: source.Source.SourceID, State: next})
			}
		}
		setState("connecting")
		for ctx.Err() == nil {
			var stream struct {
				IsOnline  bool `json:"isOnline"`
				HasAccess bool `json:"hasAccess"`
			}
			err := provider.request(ctx, source.Credentials.AccessToken, path, &stream)
			var httpError *ProviderHTTPError
			if (err == nil && !stream.IsOnline) || (errors.As(err, &httpError) && httpError.Status == http.StatusNotFound) {
				setState("offline")
				if !provider.wait(ctx, 30*time.Second) {
					return
				}
				continue
			}
			if err == nil && !stream.HasAccess {
				err = &ProviderError{Type: "provider unauthorized", Detail: "The Boosty account cannot read this stream"}
			}
			if err == nil {
				var messages []boostyMessage
				var newest string
				messages, newest, err = provider.poll(ctx, source, path+"/chat", lastID, initialized, highWater)
				if err == nil {
					for index := len(messages) - 1; index >= 0; index-- {
						raw := messages[index]
						id := string(raw.ID)
						if raw.CreatedAt < highWater || seen[id] {
							continue
						}
						if initialized {
							if message, ok := raw.normalize(source.Source); ok {
								sendStreamEvent(ctx, events, StreamEvent{Type: "message", Message: &message})
							}
						}
						if raw.CreatedAt > highWater {
							highWater = raw.CreatedAt
							clear(seen)
						}
						seen[id] = true
					}
					if newest != "" {
						lastID = newest
					}
					initialized = true
					setState("live")
					retry = 5 * time.Second
					if !provider.wait(ctx, retry) {
						return
					}
					continue
				}
			}
			state = "error"
			sendProviderError(ctx, failures, err)
			if providerErrorType(err) == "provider unauthorized" {
				<-ctx.Done()
				return
			}
			if !provider.wait(ctx, retry) {
				return
			}
			retry = min(retry*2, time.Minute)
		}
	}()
	return events, failures
}

// Walk backwards to the last observed message before publishing in chronological order.
func (provider *BoostyProvider) poll(ctx context.Context, source ConnectedSource, path, lastID string, initialized bool, highWater int64) ([]boostyMessage, string, error) {
	var messages []boostyMessage
	newest := ""
	offset := ""
	for pageIndex := 0; pageIndex < 20; pageIndex++ {
		query := url.Values{"limit": {"100"}}
		if offset != "" {
			query.Set("offset", offset)
		}
		var page boostyChatPage
		if err := provider.request(ctx, source.Credentials.AccessToken, path+"?"+query.Encode(), &page); err != nil {
			return nil, "", err
		}
		if page.Data == nil || page.Extra == nil {
			return nil, "", operationError("Boosty returned an invalid chat page", errors.New("missing data or pagination metadata"))
		}
		for _, message := range page.Data {
			if newest == "" {
				newest = string(message.ID)
			}
			if (lastID != "" && string(message.ID) == lastID) || (highWater > 0 && message.CreatedAt > 0 && message.CreatedAt < highWater) {
				return messages, newest, nil
			}
			messages = append(messages, message)
		}
		if !initialized || page.Extra.IsLast || len(page.Data) == 0 {
			return messages, newest, nil
		}
		if page.Extra.Offset == "" || page.Extra.Offset == offset {
			return nil, "", operationError("Boosty chat pagination failed", errors.New("missing or repeated cursor"))
		}
		offset = page.Extra.Offset
	}
	return nil, "", operationError("Boosty chat catch-up limit exceeded", errors.New("more than 2000 unseen messages"))
}
func (*BoostyProvider) SendMessage(context.Context, ConnectedSource, string) error {
	return &ProviderError{Type: "provider rejected command", Detail: "Boosty chat is read-only"}
}
func (*BoostyProvider) Moderate(context.Context, ConnectedSource, ModerationCommand, string) (ProviderCommandSuccess, error) {
	return ProviderCommandSuccess{}, &ProviderError{Type: "provider rejected command", Detail: "Boosty moderation is unavailable"}
}

var _ Provider = (*BoostyProvider)(nil)
