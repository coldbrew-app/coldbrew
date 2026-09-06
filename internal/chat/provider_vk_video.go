package chat

import (
	"context"
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

const (
	vkAPIVersion     = "5.199"
	vkStreamRetry    = 5 * time.Second
	vkStreamRetryMax = time.Minute
)

type VKVideoProvider struct {
	client *http.Client
	apiURL string
	wait   func(context.Context, time.Duration) bool
}

func NewVKVideoProvider(client *http.Client) *VKVideoProvider {
	return &VKVideoProvider{client: client, apiURL: "https://api.vk.ru/method", wait: waitFor}
}

func (*VKVideoProvider) Name() string       { return "vk_video" }
func (*VKVideoProvider) Collection() string { return "pull" }

func (provider *VKVideoProvider) Stream(ctx context.Context, source ConnectedSource) (<-chan StreamEvent, <-chan error) {
	events := make(chan StreamEvent)
	errorsChannel := make(chan error)
	go func() {
		defer close(events)
		defer close(errorsChannel)
		if source.Credentials.AccessToken == "" {
			sendProviderError(ctx, errorsChannel, &ProviderError{Type: "provider unauthorized", Detail: "VK Video authorization is required"})
			return
		}
		sendStreamEvent(ctx, events, StreamEvent{Type: "state", SourceID: source.Source.SourceID, State: "connecting"})
		retry := vkStreamRetry
		for ctx.Err() == nil {
			broadcast, err := provider.activeBroadcast(ctx, source)
			if err != nil {
				sendProviderError(ctx, errorsChannel, err)
				if providerErrorType(err) == "provider unauthorized" || !provider.wait(ctx, retry) {
					return
				}
				retry = min(retry*2, vkStreamRetryMax)
				sendStreamEvent(ctx, events, StreamEvent{Type: "state", SourceID: source.Source.SourceID, State: "connecting"})
				continue
			}
			if broadcast.VideoID == 0 {
				sendStreamEvent(ctx, events, StreamEvent{Type: "state", SourceID: source.Source.SourceID, State: "offline"})
				<-ctx.Done()
				return
			}
			if err := provider.streamBroadcast(ctx, source, broadcast, events); err != nil {
				sendProviderError(ctx, errorsChannel, err)
				if providerErrorType(err) == "provider unauthorized" || !provider.wait(ctx, retry) {
					return
				}
				retry = min(retry*2, vkStreamRetryMax)
				sendStreamEvent(ctx, events, StreamEvent{Type: "state", SourceID: source.Source.SourceID, State: "connecting"})
				continue
			}
			return
		}
	}()
	return events, errorsChannel
}

type vkBroadcast struct {
	OwnerID int64
	VideoID int64
}

func (provider *VKVideoProvider) activeBroadcast(ctx context.Context, source ConnectedSource) (vkBroadcast, error) {
	ownerID, err := strconv.ParseInt(source.Source.ProviderSourceID, 10, 64)
	if err != nil || ownerID <= 0 {
		return vkBroadcast{}, &ProviderError{Type: "provider unavailable", Detail: "VK Video channel identifier is invalid", Cause: err}
	}
	var response struct {
		Items []struct {
			ID      int64 `json:"id"`
			OwnerID int64 `json:"owner_id"`
			Live    int   `json:"live"`
		} `json:"items"`
	}
	query := url.Values{"owner_id": {strconv.FormatInt(ownerID, 10)}, "count": {"200"}}
	if err := provider.requestAPI(ctx, source, "video.get", query, &response, "Could not discover the active VK Video broadcast"); err != nil {
		return vkBroadcast{}, err
	}
	for _, item := range response.Items {
		if item.Live == 1 && item.ID > 0 && item.OwnerID != 0 {
			return vkBroadcast{OwnerID: item.OwnerID, VideoID: item.ID}, nil
		}
	}
	return vkBroadcast{}, nil
}

func (provider *VKVideoProvider) streamBroadcast(ctx context.Context, source ConnectedSource, broadcast vkBroadcast, events chan<- StreamEvent) error {
	var response struct {
		URL string `json:"url"`
	}
	query := url.Values{"owner_id": {strconv.FormatInt(broadcast.OwnerID, 10)}, "video_id": {strconv.FormatInt(broadcast.VideoID, 10)}}
	if err := provider.requestAPI(ctx, source, "video.getLongPollServer", query, &response, "Could not connect to VK Video chat"); err != nil {
		return err
	}
	longPollURL, err := url.Parse(response.URL)
	if err != nil || !provider.validLongPollURL(longPollURL) {
		return &ProviderError{Type: "provider unavailable", Detail: "VK Video returned an invalid chat server", Cause: err}
	}
	sendStreamEvent(ctx, events, StreamEvent{Type: "state", SourceID: source.Source.SourceID, State: "live"})
	for ctx.Err() == nil {
		poll, err := provider.poll(ctx, longPollURL)
		if err != nil {
			return err
		}
		if poll.Failed != 0 {
			return &ProviderError{Type: "provider unavailable", Detail: "VK Video chat session expired"}
		}
		if poll.TS != "" {
			query := longPollURL.Query()
			query.Set("ts", string(poll.TS))
			longPollURL.RawQuery = query.Encode()
		}
		for _, rawEvent := range poll.Events {
			message, ok := vkVideoMessage(source, rawEvent)
			if ok {
				sendStreamEvent(ctx, events, StreamEvent{Type: "message", Message: &message})
			}
		}
	}
	return nil
}

type vkLongPollResponse struct {
	TS     stringOrNumber    `json:"ts"`
	Failed int               `json:"failed"`
	Events []json.RawMessage `json:"events"`
}

func (provider *VKVideoProvider) poll(ctx context.Context, longPollURL *url.URL) (vkLongPollResponse, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, longPollURL.String(), nil)
	if err != nil {
		return vkLongPollResponse{}, operationError("VK Video chat connection failed", err)
	}
	response, err := provider.client.Do(request)
	if err != nil {
		return vkLongPollResponse{}, operationError("VK Video chat connection failed", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		_, _ = io.Copy(io.Discard, response.Body)
		return vkLongPollResponse{}, operationError("VK Video chat connection failed", &ProviderHTTPError{Status: response.StatusCode})
	}
	var result vkLongPollResponse
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		return vkLongPollResponse{}, operationError("VK Video chat connection failed", err)
	}
	return result, nil
}

func (provider *VKVideoProvider) validLongPollURL(value *url.URL) bool {
	if value == nil || value.Hostname() == "" || value.User != nil {
		return false
	}
	api, err := url.Parse(provider.apiURL)
	if err == nil && api.Scheme == "http" && value.Scheme == "http" && value.Host == api.Host {
		return true
	}
	if value.Scheme != "https" {
		return false
	}
	host := strings.ToLower(value.Hostname())
	if host == "vk.ru" || strings.HasSuffix(host, ".vk.ru") || host == "vk.com" || strings.HasSuffix(host, ".vk.com") {
		return true
	}
	return false
}

type vkVideoEvent struct {
	Type    string `json:"type"`
	Comment struct {
		ID     stringOrNumber `json:"id"`
		FromID stringOrNumber `json:"from_id"`
		Text   string         `json:"text"`
		Date   int64          `json:"date"`
	} `json:"comment"`
	User struct {
		ID        stringOrNumber `json:"id"`
		FirstName string         `json:"first_name"`
		LastName  string         `json:"last_name"`
	} `json:"user"`
	Group struct {
		ID   stringOrNumber `json:"id"`
		Name string         `json:"name"`
	} `json:"group"`
}

func vkVideoMessage(source ConnectedSource, raw json.RawMessage) (Message, bool) {
	body := raw
	if len(raw) > 0 && raw[0] == '"' {
		var encoded string
		if err := json.Unmarshal(raw, &encoded); err != nil {
			return Message{}, false
		}
		body = []byte(encoded)
	}
	if end := strings.LastIndexByte(string(body), '}'); end >= 0 {
		body = body[:end+1]
	}
	var event vkVideoEvent
	if err := json.Unmarshal(body, &event); err != nil || (event.Type != "video_comment_new" && event.Type != "video_special_comment_new") || event.Comment.ID == "" || event.Comment.FromID == "" || event.Comment.Date <= 0 || event.Comment.Text == "" {
		return Message{}, false
	}
	authorID := string(event.Comment.FromID)
	displayName := strings.TrimSpace(event.User.FirstName + " " + event.User.LastName)
	if strings.HasPrefix(authorID, "-") && event.Group.Name != "" {
		displayName = event.Group.Name
	}
	if displayName == "" {
		displayName = authorID
	}
	return Message{ID: string(event.Comment.ID), SourceID: source.Source.SourceID, ConnectionID: source.Source.ConnectionID, Provider: "vk_video", Author: Author{ID: authorID, DisplayName: displayName}, Text: event.Comment.Text, OccurredAt: time.Unix(event.Comment.Date, 0).UTC()}, true
}

func (provider *VKVideoProvider) requestAPI(ctx context.Context, source ConnectedSource, method string, query url.Values, target any, detail string) error {
	if source.Credentials.AccessToken == "" {
		return &ProviderError{Type: "provider unauthorized", Detail: "VK Video authorization is required"}
	}
	query.Set("v", vkAPIVersion)
	query.Set("access_token", source.Credentials.AccessToken)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, provider.apiURL+"/"+method+"?"+query.Encode(), nil)
	if err != nil {
		return operationError(detail, err)
	}
	response, err := provider.client.Do(request)
	if err != nil {
		return operationError(detail, err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		_, _ = io.Copy(io.Discard, response.Body)
		return operationError(detail, &ProviderHTTPError{Status: response.StatusCode})
	}
	var envelope struct {
		Response json.RawMessage `json:"response"`
		Error    *struct {
			Code    int    `json:"error_code"`
			Message string `json:"error_msg"`
		} `json:"error"`
	}
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		return operationError(detail, err)
	}
	if envelope.Error != nil {
		cause := fmt.Errorf("VK API %d: %s", envelope.Error.Code, envelope.Error.Message)
		typeName := "provider unavailable"
		if envelope.Error.Code == 5 || envelope.Error.Code == 7 || envelope.Error.Code == 15 || envelope.Error.Code == 204 {
			typeName = "provider unauthorized"
		} else if envelope.Error.Code == 6 || envelope.Error.Code == 29 {
			typeName = "provider rate limited"
		}
		return &ProviderError{Type: typeName, Detail: detail, Cause: cause}
	}
	if len(envelope.Response) == 0 {
		return operationError(detail, errors.New("VK API response is incomplete"))
	}
	if err := json.Unmarshal(envelope.Response, target); err != nil {
		return operationError(detail, err)
	}
	return nil
}

func (*VKVideoProvider) SendMessage(context.Context, ConnectedSource, string) error {
	return &ProviderError{Type: "provider rejected command", Detail: "VK Video chat is read-only"}
}

func (*VKVideoProvider) Moderate(context.Context, ConnectedSource, ModerationCommand, string) (ProviderCommandSuccess, error) {
	return ProviderCommandSuccess{}, &ProviderError{Type: "provider rejected command", Detail: "VK Video moderation is unavailable"}
}

var _ Provider = (*VKVideoProvider)(nil)
