package chat

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const refreshEarly = time.Minute

type RefreshConfig struct {
	Provider     string
	ClientID     string
	ClientSecret string
	TokenURL     string
}

type CredentialStore interface {
	UpdateConnectionCredentials(context.Context, string, int, string, string, *time.Time) (*int, error)
}

type TokenRefresher struct {
	store   CredentialStore
	configs map[string]RefreshConfig
	client  *http.Client
	now     func() time.Time
}

func NewTokenRefresher(store CredentialStore, configs []RefreshConfig, client *http.Client) *TokenRefresher {
	byProvider := make(map[string]RefreshConfig, len(configs))
	for _, config := range configs {
		byProvider[config.Provider] = config
	}
	return &TokenRefresher{store: store, configs: byProvider, client: client, now: time.Now}
}

func (refresher *TokenRefresher) Refresh(ctx context.Context, source ConnectedSource) (ConnectedSource, error) {
	expiresAt := source.Credentials.ExpiresAt
	if expiresAt == nil || expiresAt.After(refresher.now().Add(refreshEarly)) {
		return source, nil
	}
	config, configured := refresher.configs[source.Source.Provider]
	if source.Credentials.RefreshToken == "" || !configured {
		return ConnectedSource{}, &ProviderError{Type: "provider unauthorized", Detail: "Подключение чата нужно авторизовать заново"}
	}
	values := url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {source.Credentials.RefreshToken},
		"client_id":     {config.ClientID},
		"client_secret": {config.ClientSecret},
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, config.TokenURL, strings.NewReader(values.Encode()))
	if err != nil {
		return ConnectedSource{}, refreshProviderError("Не удалось обновить авторизацию чата", err)
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := refresher.client.Do(request)
	if err != nil {
		return ConnectedSource{}, refreshProviderError("Не удалось обновить авторизацию чата", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		_, _ = io.Copy(io.Discard, response.Body)
		return ConnectedSource{}, refreshProviderError("Не удалось обновить авторизацию чата", &ProviderHTTPError{Status: response.StatusCode})
	}
	var token struct {
		AccessToken  string  `json:"access_token"`
		RefreshToken *string `json:"refresh_token"`
		ExpiresIn    *int    `json:"expires_in"`
	}
	if err := json.NewDecoder(response.Body).Decode(&token); err != nil || token.AccessToken == "" || (token.RefreshToken != nil && *token.RefreshToken == "") || (token.ExpiresIn != nil && *token.ExpiresIn <= 0) {
		if err == nil {
			err = errors.New("invalid token response")
		}
		return ConnectedSource{}, refreshProviderError("Не удалось обновить авторизацию чата", err)
	}
	refreshToken := source.Credentials.RefreshToken
	if token.RefreshToken != nil {
		refreshToken = *token.RefreshToken
	}
	var nextExpiry *time.Time
	if token.ExpiresIn != nil {
		value := refresher.now().Add(time.Duration(*token.ExpiresIn) * time.Second)
		nextExpiry = &value
	}
	nextVersion, err := refresher.store.UpdateConnectionCredentials(ctx, source.Source.ConnectionID, source.Credentials.TokenVersion, token.AccessToken, refreshToken, nextExpiry)
	if err != nil {
		return ConnectedSource{}, err
	}
	if nextVersion == nil {
		return ConnectedSource{}, &ProviderError{Type: "provider unavailable", Detail: "Авторизация чата уже обновляется другим экземпляром сервиса"}
	}
	next := source
	next.Credentials = ProviderCredentials{AccessToken: token.AccessToken, RefreshToken: refreshToken, ExpiresAt: nextExpiry, Scopes: append([]string(nil), source.Credentials.Scopes...), TokenVersion: *nextVersion}
	return next, nil
}

func refreshProviderError(detail string, cause error) error {
	return &ProviderError{Type: "provider unauthorized", Detail: detail, Cause: cause}
}

type RefreshingProvider struct {
	delegate  Provider
	refresher *TokenRefresher
}

func NewRefreshingProvider(delegate Provider, refresher *TokenRefresher) *RefreshingProvider {
	return &RefreshingProvider{delegate: delegate, refresher: refresher}
}

func (provider *RefreshingProvider) Name() string       { return provider.delegate.Name() }
func (provider *RefreshingProvider) Collection() string { return provider.delegate.Collection() }

func (provider *RefreshingProvider) Stream(ctx context.Context, source ConnectedSource) (<-chan StreamEvent, <-chan error) {
	events := make(chan StreamEvent)
	errorsChannel := make(chan error)
	go func() {
		defer close(events)
		defer close(errorsChannel)
		refreshed, err := provider.refresher.Refresh(ctx, source)
		if err != nil {
			sendProviderError(ctx, errorsChannel, err)
			return
		}
		streamCtx, cancel := context.WithCancel(ctx)
		defer cancel()
		if refreshed.Credentials.ExpiresAt != nil {
			delay := refreshed.Credentials.ExpiresAt.Sub(provider.refresher.now()) - refreshEarly
			if delay < 0 {
				delay = 0
			}
			timer := time.AfterFunc(delay, cancel)
			defer timer.Stop()
		}
		delegateEvents, delegateErrors := provider.delegate.Stream(streamCtx, refreshed)
		for delegateEvents != nil || delegateErrors != nil {
			select {
			case <-ctx.Done():
				return
			case event, open := <-delegateEvents:
				if !open {
					delegateEvents = nil
					continue
				}
				sendStreamEvent(ctx, events, event)
			case providerError, open := <-delegateErrors:
				if !open {
					delegateErrors = nil
					continue
				}
				sendProviderError(ctx, errorsChannel, providerError)
			}
		}
	}()
	return events, errorsChannel
}

func (provider *RefreshingProvider) SendMessage(ctx context.Context, source ConnectedSource, text string) error {
	refreshed, err := provider.refresher.Refresh(ctx, source)
	if err != nil {
		return err
	}
	return provider.delegate.SendMessage(ctx, refreshed, text)
}

func (provider *RefreshingProvider) Moderate(ctx context.Context, source ConnectedSource, command ModerationCommand, providerBanID string) (ProviderCommandSuccess, error) {
	refreshed, err := provider.refresher.Refresh(ctx, source)
	if err != nil {
		return ProviderCommandSuccess{}, err
	}
	return provider.delegate.Moderate(ctx, refreshed, command, providerBanID)
}

func TokenRefreshConfigs(youtube, twitch, kick *[2]string) []RefreshConfig {
	configs := make([]RefreshConfig, 0, 3)
	if youtube != nil {
		configs = append(configs, RefreshConfig{Provider: "youtube", ClientID: youtube[0], ClientSecret: youtube[1], TokenURL: "https://oauth2.googleapis.com/token"})
	}
	if twitch != nil {
		configs = append(configs, RefreshConfig{Provider: "twitch", ClientID: twitch[0], ClientSecret: twitch[1], TokenURL: "https://id.twitch.tv/oauth2/token"})
	}
	if kick != nil {
		configs = append(configs, RefreshConfig{Provider: "kick", ClientID: kick[0], ClientSecret: kick[1], TokenURL: "https://id.kick.com/oauth/token"})
	}
	return configs
}

var _ CredentialStore = (*Store)(nil)
var _ Provider = (*RefreshingProvider)(nil)
