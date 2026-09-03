package chat

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
)

const maxSafeInteger = int64(9_007_199_254_740_991)

type KickProvider struct {
	client  *http.Client
	baseURL string
}

func NewKickProvider(client *http.Client) *KickProvider {
	return &KickProvider{client: client, baseURL: "https://api.kick.com"}
}

func (*KickProvider) Name() string       { return "kick" }
func (*KickProvider) Collection() string { return "push" }

func (*KickProvider) Stream(ctx context.Context, source ConnectedSource) (<-chan StreamEvent, <-chan error) {
	events := make(chan StreamEvent, 1)
	errorsChannel := make(chan error)
	events <- StreamEvent{Type: "state", SourceID: source.Source.SourceID, State: "connecting", Detail: "Waiting for Kick webhook events"}
	go func() {
		<-ctx.Done()
		close(events)
		close(errorsChannel)
	}()
	return events, errorsChannel
}

func (provider *KickProvider) SendMessage(ctx context.Context, source ConnectedSource, text string) error {
	broadcasterID, err := kickUserID(source.Source.ProviderSourceID)
	if err != nil {
		return err
	}
	body := map[string]any{"broadcaster_user_id": broadcasterID, "content": text, "type": "user"}
	return provider.request(ctx, source, http.MethodPost, "/public/v1/chat", body, "Kick rejected the chat message")
}

func (provider *KickProvider) Moderate(ctx context.Context, source ConnectedSource, command ModerationCommand, _ string) (ProviderCommandSuccess, error) {
	broadcasterID, err := kickUserID(source.Source.ProviderSourceID)
	if err != nil {
		return ProviderCommandSuccess{}, err
	}
	if command.Type == "delete_message" {
		path := "/public/v1/chat/" + url.PathEscape(command.MessageID)
		return ProviderCommandSuccess{}, provider.request(ctx, source, http.MethodDelete, path, nil, "Kick rejected the message deletion")
	}
	userID, err := kickUserID(command.ProviderUserID)
	if err != nil {
		return ProviderCommandSuccess{}, err
	}
	body := map[string]any{"broadcaster_user_id": broadcasterID, "user_id": userID}
	method := http.MethodPost
	detail := "Kick rejected the moderation action"
	if command.Type == "unban_user" {
		method = http.MethodDelete
		detail = "Kick rejected the unban"
	} else {
		if command.Type == "timeout_user" {
			body["duration"] = (command.DurationSeconds + 59) / 60
		}
		if command.Reason != "" {
			body["reason"] = command.Reason
		}
	}
	return ProviderCommandSuccess{}, provider.request(ctx, source, method, "/public/v1/moderation/bans", body, detail)
}

func (provider *KickProvider) request(ctx context.Context, source ConnectedSource, method, path string, body any, detail string) error {
	if source.Credentials.AccessToken == "" {
		return operationError("Kick authorization is required", errors.New("access token missing"))
	}
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return operationError(detail, err)
		}
		reader = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, provider.baseURL+path, reader)
	if err != nil {
		return operationError(detail, err)
	}
	request.Header.Set("Authorization", "Bearer "+source.Credentials.AccessToken)
	request.Header.Set("Content-Type", "application/json")
	response, err := provider.client.Do(request)
	if err != nil {
		return operationError(detail, err)
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, response.Body)
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return operationError(detail, &ProviderHTTPError{Status: response.StatusCode})
	}
	return nil
}

func kickUserID(value string) (int64, error) {
	id, err := strconv.ParseInt(value, 10, 64)
	if err != nil || id <= 0 || id > maxSafeInteger {
		return 0, &ProviderError{Type: "provider unavailable", Detail: "Invalid Kick user ID", Cause: err}
	}
	return id, nil
}

var _ Provider = (*KickProvider)(nil)
