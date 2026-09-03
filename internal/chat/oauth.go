package chat

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const oauthAttemptLifetime = 10 * time.Minute

type ProviderConfig struct {
	Provider         string
	ClientID         string
	ClientSecret     string
	AuthorizationURL string
	TokenURL         string
	Scopes           []string
}

type OauthError struct {
	Type      string
	Detail    string
	ReturnURL string
	Cause     error
}

func (e *OauthError) Error() string { return e.Detail }
func (e *OauthError) Unwrap() error { return e.Cause }

type OauthStore interface {
	CreateOauthAttempt(context.Context, string, int, string, string, string, time.Time) error
	ConsumeOauthAttempt(context.Context, string, string) (*OauthAttempt, error)
	HasSourceCapacity(context.Context, int, string, string) (bool, error)
	SaveProviderAccount(context.Context, int, SaveConnection, SaveSource) (string, error)
}

type Oauth struct {
	store     OauthStore
	publicURL string
	configs   map[string]ProviderConfig
	client    *http.Client
	now       func() time.Time
}

func NewOauth(store OauthStore, publicURL string, configs []ProviderConfig, client *http.Client) *Oauth {
	byProvider := make(map[string]ProviderConfig, len(configs))
	for _, config := range configs {
		byProvider[config.Provider] = config
	}
	return &Oauth{store: store, publicURL: publicURL, configs: byProvider, client: client, now: time.Now}
}

func (oauth *Oauth) Available(provider string) bool {
	_, available := oauth.configs[provider]
	return available
}

func (oauth *Oauth) Start(ctx context.Context, userID int, provider, returnURL string) (string, error) {
	config, exists := oauth.configs[provider]
	if !exists {
		return "", &OauthError{Type: "oauth provider unavailable", Detail: "OAuth для " + provider + " не настроен"}
	}
	state, err := randomBase64URL(32)
	if err != nil {
		return "", err
	}
	verifier, err := randomBase64URL(48)
	if err != nil {
		return "", err
	}
	if err := oauth.store.CreateOauthAttempt(ctx, sha256Hex(state), userID, provider, verifier, returnURL, oauth.now().Add(oauthAttemptLifetime)); err != nil {
		return "", err
	}
	authorizationURL, err := url.Parse(config.AuthorizationURL)
	if err != nil {
		return "", err
	}
	parameters := authorizationURL.Query()
	parameters.Set("response_type", "code")
	parameters.Set("client_id", config.ClientID)
	parameters.Set("redirect_uri", oauth.callbackURL(provider))
	parameters.Set("scope", strings.Join(config.Scopes, " "))
	parameters.Set("state", state)
	parameters.Set("code_challenge", sha256Base64URL(verifier))
	parameters.Set("code_challenge_method", "S256")
	if provider == "youtube" {
		parameters.Set("access_type", "offline")
		parameters.Set("prompt", "consent")
	}
	authorizationURL.RawQuery = parameters.Encode()
	return authorizationURL.String(), nil
}

func (oauth *Oauth) Finish(ctx context.Context, provider, requestURL string) (string, error) {
	callback, err := url.Parse(requestURL)
	if err != nil {
		return "", &OauthError{Type: "invalid oauth callback", Detail: "OAuth callback is incomplete", Cause: err}
	}
	state, code := callback.Query().Get("state"), callback.Query().Get("code")
	if state == "" || code == "" || callback.Query().Has("error") {
		return "", &OauthError{Type: "invalid oauth callback", Detail: "OAuth callback is incomplete"}
	}
	attempt, err := oauth.store.ConsumeOauthAttempt(ctx, sha256Hex(state), provider)
	if err != nil {
		return "", err
	}
	if attempt == nil {
		return "", &OauthError{Type: "expired oauth attempt", Detail: "OAuth attempt expired"}
	}
	config, exists := oauth.configs[provider]
	if !exists {
		return "", &OauthError{Type: "oauth provider unavailable", Detail: "OAuth для " + provider + " не настроен", ReturnURL: attempt.ReturnURL}
	}
	token, err := oauth.exchangeToken(ctx, config, code, attempt.Verifier)
	if err != nil {
		return "", &OauthError{Type: "oauth token exchange failed", Detail: "Не удалось завершить OAuth " + provider, ReturnURL: attempt.ReturnURL, Cause: err}
	}
	identity, err := oauth.identity(ctx, config, token.AccessToken)
	if err != nil {
		var oauthError *OauthError
		if errors.As(err, &oauthError) {
			oauthError.ReturnURL = attempt.ReturnURL
		}
		return "", err
	}
	capacity, err := oauth.store.HasSourceCapacity(ctx, attempt.UserID, provider, identity.ProviderUserID)
	if err != nil {
		return "", err
	}
	if !capacity {
		return "", &OauthError{Type: "chat source limit reached", Detail: "Достигнут лимит подключённых чат-каналов", ReturnURL: attempt.ReturnURL}
	}
	if provider == "kick" {
		broadcasterID, err := strconv.ParseInt(identity.ProviderUserID, 10, 64)
		if err != nil || broadcasterID <= 0 || broadcasterID > maxSafeInteger {
			return "", &OauthError{Type: "oauth profile failed", Detail: "Kick вернул некорректный идентификатор канала", ReturnURL: attempt.ReturnURL}
		}
		body, _ := json.Marshal(map[string]any{"broadcaster_user_id": broadcasterID, "method": "webhook", "events": []map[string]any{{"name": "chat.message.sent", "version": 1}}})
		if err := oauth.requestJSON(ctx, http.MethodPost, "https://api.kick.com/public/v1/events/subscriptions", strings.NewReader(string(body)), token.AccessToken, "application/json", nil); err != nil {
			return "", &OauthError{Type: "oauth profile failed", Detail: "Не удалось подписаться на события чата Kick", ReturnURL: attempt.ReturnURL, Cause: err}
		}
	}
	var expiresAt *time.Time
	if token.ExpiresIn != nil {
		value := oauth.now().Add(time.Duration(*token.ExpiresIn) * time.Second)
		expiresAt = &value
	}
	_, err = oauth.store.SaveProviderAccount(ctx, attempt.UserID, SaveConnection{Provider: provider, ProviderUserID: identity.ProviderUserID, DisplayName: identity.DisplayName, AccessToken: token.AccessToken, RefreshToken: token.RefreshToken, AccessTokenExpiresAt: expiresAt, Scopes: normalizedScopes(token.Scope, config.Scopes)}, SaveSource{Provider: provider, ProviderSourceID: identity.ProviderUserID, DisplayName: identity.DisplayName, SourceURL: identity.SourceURL})
	if err != nil {
		return "", err
	}
	return attempt.ReturnURL, nil
}

type oauthToken struct {
	AccessToken  string
	RefreshToken string
	ExpiresIn    *int
	Scope        any
}

func (oauth *Oauth) exchangeToken(ctx context.Context, config ProviderConfig, code, verifier string) (oauthToken, error) {
	values := url.Values{"grant_type": {"authorization_code"}, "code": {code}, "client_id": {config.ClientID}, "client_secret": {config.ClientSecret}, "redirect_uri": {oauth.callbackURL(config.Provider)}, "code_verifier": {verifier}}
	var raw struct {
		AccessToken  string          `json:"access_token"`
		RefreshToken *string         `json:"refresh_token"`
		ExpiresIn    *int            `json:"expires_in"`
		Scope        json.RawMessage `json:"scope"`
	}
	if err := oauth.requestJSON(ctx, http.MethodPost, config.TokenURL, strings.NewReader(values.Encode()), "", "application/x-www-form-urlencoded", &raw); err != nil {
		return oauthToken{}, err
	}
	if raw.AccessToken == "" {
		return oauthToken{}, errors.New("missing access token")
	}
	if raw.RefreshToken != nil && *raw.RefreshToken == "" {
		return oauthToken{}, errors.New("invalid refresh token")
	}
	if raw.ExpiresIn != nil && *raw.ExpiresIn <= 0 {
		return oauthToken{}, errors.New("invalid token expiry")
	}
	var scope any
	if len(raw.Scope) != 0 {
		if err := json.Unmarshal(raw.Scope, &scope); err != nil {
			return oauthToken{}, err
		}
		if !validOauthScopes(scope) {
			return oauthToken{}, errors.New("invalid OAuth scope")
		}
	}
	refreshToken := ""
	if raw.RefreshToken != nil {
		refreshToken = *raw.RefreshToken
	}
	return oauthToken{AccessToken: raw.AccessToken, RefreshToken: refreshToken, ExpiresIn: raw.ExpiresIn, Scope: scope}, nil
}

func validOauthScopes(value any) bool {
	if _, ok := value.(string); ok {
		return true
	}
	items, ok := value.([]any)
	if !ok {
		return false
	}
	for _, item := range items {
		if _, ok := item.(string); !ok {
			return false
		}
	}
	return true
}

type providerIdentity struct {
	ProviderUserID string
	DisplayName    string
	SourceURL      string
}

func (oauth *Oauth) identity(ctx context.Context, config ProviderConfig, accessToken string) (providerIdentity, error) {
	if config.Provider == "youtube" {
		var payload struct {
			Items []struct {
				ID      string `json:"id"`
				Snippet struct {
					Title string `json:"title"`
				} `json:"snippet"`
			} `json:"items"`
		}
		if err := oauth.requestJSON(ctx, http.MethodGet, "https://www.googleapis.com/youtube/v3/channels?part=id%2Csnippet&mine=true", nil, accessToken, "", &payload); err != nil || len(payload.Items) == 0 || payload.Items[0].ID == "" || payload.Items[0].Snippet.Title == "" {
			return providerIdentity{}, &OauthError{Type: "oauth profile failed", Detail: "Не удалось получить канал YouTube", Cause: err}
		}
		channel := payload.Items[0]
		return providerIdentity{ProviderUserID: channel.ID, DisplayName: channel.Snippet.Title, SourceURL: "https://www.youtube.com/channel/" + channel.ID}, nil
	}
	if config.Provider == "twitch" {
		var payload struct {
			Data []struct {
				ID          string `json:"id"`
				Login       string `json:"login"`
				DisplayName string `json:"display_name"`
			} `json:"data"`
		}
		if err := oauth.requestJSON(ctx, http.MethodGet, "https://api.twitch.tv/helix/users", nil, accessToken, "", &payload); err != nil || len(payload.Data) == 0 || payload.Data[0].ID == "" || payload.Data[0].Login == "" || payload.Data[0].DisplayName == "" {
			return providerIdentity{}, &OauthError{Type: "oauth profile failed", Detail: "Не удалось получить канал Twitch", Cause: err}
		}
		channel := payload.Data[0]
		login := strings.ToLower(channel.Login)
		return providerIdentity{ProviderUserID: channel.ID, DisplayName: login, SourceURL: "https://www.twitch.tv/" + login}, nil
	}
	var payload struct {
		Data []struct {
			BroadcasterUserID stringOrNumber `json:"broadcaster_user_id"`
			Slug              string         `json:"slug"`
		} `json:"data"`
	}
	if err := oauth.requestJSON(ctx, http.MethodGet, "https://api.kick.com/public/v1/channels", nil, accessToken, "", &payload); err != nil || len(payload.Data) == 0 || payload.Data[0].BroadcasterUserID == "" || payload.Data[0].Slug == "" {
		return providerIdentity{}, &OauthError{Type: "oauth profile failed", Detail: "Не удалось получить канал Kick", Cause: err}
	}
	channel := payload.Data[0]
	return providerIdentity{ProviderUserID: string(channel.BroadcasterUserID), DisplayName: channel.Slug, SourceURL: "https://kick.com/" + channel.Slug}, nil
}

type stringOrNumber string

func (value *stringOrNumber) UnmarshalJSON(body []byte) error {
	if len(body) > 0 && body[0] == '"' {
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

func (oauth *Oauth) requestJSON(ctx context.Context, method, rawURL string, body io.Reader, accessToken, contentType string, target any) error {
	request, err := http.NewRequestWithContext(ctx, method, rawURL, body)
	if err != nil {
		return err
	}
	if accessToken != "" {
		request.Header.Set("Authorization", "Bearer "+accessToken)
	}
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	if strings.Contains(rawURL, "api.twitch.tv") {
		request.Header.Set("Client-Id", oauth.configs["twitch"].ClientID)
	}
	response, err := oauth.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("HTTP %d", response.StatusCode)
	}
	if target == nil {
		_, err = io.Copy(io.Discard, response.Body)
		return err
	}
	return json.NewDecoder(response.Body).Decode(target)
}

func (oauth *Oauth) callbackURL(provider string) string {
	parsed, _ := url.Parse(oauth.publicURL)
	parsed.Path = strings.TrimSuffix(parsed.Path, "/") + "/oauth/" + provider + "/callback"
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String()
}

func normalizedScopes(value any, fallback []string) []string {
	switch scopes := value.(type) {
	case string:
		return strings.FieldsFunc(scopes, func(character rune) bool { return character == ' ' || character == ',' })
	case []any:
		result := make([]string, 0, len(scopes))
		for _, scope := range scopes {
			if text, ok := scope.(string); ok {
				result = append(result, text)
			}
		}
		return result
	default:
		return append([]string(nil), fallback...)
	}
}

func OauthConfigs(youtube, twitch, kick *[2]string) []ProviderConfig {
	configs := make([]ProviderConfig, 0, 3)
	if youtube != nil {
		configs = append(configs, ProviderConfig{Provider: "youtube", ClientID: youtube[0], ClientSecret: youtube[1], AuthorizationURL: "https://accounts.google.com/o/oauth2/v2/auth", TokenURL: "https://oauth2.googleapis.com/token", Scopes: []string{"https://www.googleapis.com/auth/youtube.force-ssl"}})
	}
	if twitch != nil {
		configs = append(configs, ProviderConfig{Provider: "twitch", ClientID: twitch[0], ClientSecret: twitch[1], AuthorizationURL: "https://id.twitch.tv/oauth2/authorize", TokenURL: "https://id.twitch.tv/oauth2/token", Scopes: []string{"user:read:chat", "user:write:chat", "moderator:manage:chat_messages", "moderator:manage:banned_users"}})
	}
	if kick != nil {
		configs = append(configs, ProviderConfig{Provider: "kick", ClientID: kick[0], ClientSecret: kick[1], AuthorizationURL: "https://id.kick.com/oauth/authorize", TokenURL: "https://id.kick.com/oauth/token", Scopes: []string{"user:read", "channel:read", "events:subscribe", "chat:write", "moderation:chat_message:manage", "moderation:ban"}})
	}
	return configs
}

func randomBase64URL(size int) (string, error) {
	value := make([]byte, size)
	_, err := rand.Read(value)
	return base64.RawURLEncoding.EncodeToString(value), err
}
func sha256Hex(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
func sha256Base64URL(value string) string {
	sum := sha256.Sum256([]byte(value))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}
