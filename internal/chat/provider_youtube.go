package chat

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/lebedev-nikita/coldbrew/internal/youtubechatpb"
)

const (
	youtubeDiscoveryRetryStart = 5 * time.Second
	youtubeDiscoveryRetryMax   = time.Minute
)

type YoutubeProvider struct {
	client *http.Client
	apiURL string
	wait   func(context.Context, time.Duration) bool
	open   youtubeLiveChatOpen
}

func NewYoutubeProvider(client *http.Client) *YoutubeProvider {
	return &YoutubeProvider{client: client, apiURL: "https://www.googleapis.com/youtube/v3", wait: waitFor, open: openYoutubeLiveChat}
}

func (*YoutubeProvider) Name() string       { return "youtube" }
func (*YoutubeProvider) Collection() string { return "pull" }

func (provider *YoutubeProvider) Stream(ctx context.Context, source ConnectedSource) (<-chan StreamEvent, <-chan error) {
	events := make(chan StreamEvent)
	errorsChannel := make(chan error)
	go func() {
		defer close(events)
		defer close(errorsChannel)
		if source.Credentials.AccessToken == "" {
			sendProviderError(ctx, errorsChannel, &ProviderError{Type: "provider unauthorized", Detail: "YouTube authorization is required"})
			return
		}
		sendStreamEvent(ctx, events, StreamEvent{Type: "state", SourceID: source.Source.SourceID, State: "connecting"})
		retry := youtubeDiscoveryRetryStart
		for ctx.Err() == nil {
			liveChatID, err := provider.activeBroadcast(ctx, source)
			if err != nil {
				sendProviderError(ctx, errorsChannel, err)
				if providerErrorType(err) == "provider unauthorized" {
					return
				}
				if !provider.wait(ctx, retry) {
					return
				}
				retry = min(retry*2, youtubeDiscoveryRetryMax)
				sendStreamEvent(ctx, events, StreamEvent{Type: "state", SourceID: source.Source.SourceID, State: "connecting"})
				continue
			}
			if liveChatID == "" {
				sendStreamEvent(ctx, events, StreamEvent{Type: "state", SourceID: source.Source.SourceID, State: "offline"})
				<-ctx.Done()
				return
			}
			provider.streamLiveChat(ctx, source, liveChatID, events, errorsChannel)
			return
		}
	}()
	return events, errorsChannel
}

func (provider *YoutubeProvider) streamLiveChat(ctx context.Context, source ConnectedSource, liveChatID string, events chan<- StreamEvent, errorsChannel chan<- error) {
	sendStreamEvent(ctx, events, StreamEvent{Type: "state", SourceID: source.Source.SourceID, State: "connecting"})
	pageToken := ""
	retry := youtubeDiscoveryRetryStart
	for ctx.Err() == nil {
		sendStreamEvent(ctx, events, StreamEvent{Type: "state", SourceID: source.Source.SourceID, State: "live"})
		session, err := provider.open(ctx, youtubeLiveChatCursor{LiveChatID: liveChatID, PageToken: pageToken}, source.Credentials.AccessToken)
		if err != nil {
			if !provider.handleYoutubeLiveChatError(ctx, source, events, errorsChannel, err) {
				return
			}
		} else {
			for ctx.Err() == nil {
				response, receiveErr := session.Recv()
				if receiveErr != nil {
					err = receiveErr
					break
				}
				retry = youtubeDiscoveryRetryStart
				if response.GetNextPageToken() != "" {
					pageToken = response.GetNextPageToken()
				}
				for _, item := range response.GetItems() {
					message, ok := youtubeMessage(source, item)
					if ok {
						sendStreamEvent(ctx, events, StreamEvent{Type: "message", Message: &message})
					}
				}
				if response.GetOfflineAt() != "" {
					_ = session.Close()
					sendStreamEvent(ctx, events, StreamEvent{Type: "state", SourceID: source.Source.SourceID, State: "offline"})
					<-ctx.Done()
					return
				}
			}
			closeErr := session.Close()
			if ctx.Err() != nil {
				return
			}
			if err == io.EOF {
				err = nil
			}
			if err == nil {
				err = closeErr
			}
			if err != nil && !provider.handleYoutubeLiveChatError(ctx, source, events, errorsChannel, err) {
				return
			}
		}
		if !provider.wait(ctx, retry) {
			return
		}
		retry = min(retry*2, youtubeDiscoveryRetryMax)
		sendStreamEvent(ctx, events, StreamEvent{Type: "state", SourceID: source.Source.SourceID, State: "connecting"})
	}
}

func youtubeMessage(source ConnectedSource, item *youtubechatpb.LiveChatMessage) (Message, bool) {
	if item == nil || item.GetSnippet() == nil || item.GetAuthorDetails() == nil || item.GetSnippet().GetType() != youtubechatpb.LiveChatMessageSnippet_TypeWrapper_TEXT_MESSAGE_EVENT || item.GetId() == "" || item.GetAuthorDetails().GetChannelId() == "" || item.GetAuthorDetails().GetDisplayName() == "" {
		return Message{}, false
	}
	occurredAt, err := time.Parse(time.RFC3339Nano, item.GetSnippet().GetPublishedAt())
	if err != nil {
		return Message{}, false
	}
	text := item.GetSnippet().GetTextMessageDetails().GetMessageText()
	if text == "" {
		text = item.GetSnippet().GetDisplayMessage()
	}
	return Message{ID: item.GetId(), SourceID: source.Source.SourceID, ConnectionID: source.Source.ConnectionID, Provider: "youtube", Author: Author{ID: item.GetAuthorDetails().GetChannelId(), DisplayName: item.GetAuthorDetails().GetDisplayName()}, Text: text, OccurredAt: occurredAt}, true
}

func (provider *YoutubeProvider) activeBroadcast(ctx context.Context, source ConnectedSource) (string, error) {
	if source.Credentials.AccessToken == "" {
		return "", &ProviderError{Type: "provider unauthorized", Detail: "YouTube authorization is required"}
	}
	query := url.Values{"part": {"snippet"}, "broadcastStatus": {"active"}, "broadcastType": {"all"}, "mine": {"true"}}
	var response struct {
		Items []struct {
			Snippet struct {
				LiveChatID string `json:"liveChatId"`
			} `json:"snippet"`
		} `json:"items"`
	}
	if err := provider.request(ctx, source, http.MethodGet, "/liveBroadcasts", query, nil, &response, "Could not discover the active YouTube broadcast"); err != nil {
		return "", err
	}
	for _, item := range response.Items {
		if item.Snippet.LiveChatID != "" {
			return item.Snippet.LiveChatID, nil
		}
	}
	return "", nil
}

func (provider *YoutubeProvider) SendMessage(ctx context.Context, source ConnectedSource, text string) error {
	liveChatID, err := provider.activeBroadcast(ctx, source)
	if err != nil {
		return err
	}
	if liveChatID == "" {
		return &ProviderError{Type: "provider unavailable", Detail: "The YouTube channel is not live"}
	}
	body := map[string]any{"snippet": map[string]any{"liveChatId": liveChatID, "type": "textMessageEvent", "textMessageDetails": map[string]string{"messageText": text}}}
	return provider.request(ctx, source, http.MethodPost, "/liveChat/messages", url.Values{"part": {"snippet"}}, body, nil, "YouTube rejected the chat command")
}

func (provider *YoutubeProvider) Moderate(ctx context.Context, source ConnectedSource, command ModerationCommand, providerBanID string) (ProviderCommandSuccess, error) {
	if command.Type == "delete_message" {
		return ProviderCommandSuccess{}, provider.request(ctx, source, http.MethodDelete, "/liveChat/messages", url.Values{"id": {command.MessageID}}, nil, nil, "YouTube rejected the chat command")
	}
	if command.Type == "unban_user" {
		if providerBanID == "" {
			return ProviderCommandSuccess{}, &ProviderError{Type: "provider rejected command", Detail: "The YouTube ban identifier is no longer available"}
		}
		return ProviderCommandSuccess{}, provider.request(ctx, source, http.MethodDelete, "/liveChat/bans", url.Values{"id": {providerBanID}}, nil, nil, "YouTube rejected the chat command")
	}
	liveChatID, err := provider.activeBroadcast(ctx, source)
	if err != nil {
		return ProviderCommandSuccess{}, err
	}
	if liveChatID == "" {
		return ProviderCommandSuccess{}, &ProviderError{Type: "provider unavailable", Detail: "The YouTube channel is not live"}
	}
	snippet := map[string]any{"liveChatId": liveChatID, "type": "permanent", "bannedUserDetails": map[string]string{"channelId": command.ProviderUserID}}
	if command.Type == "timeout_user" {
		snippet["type"] = "temporary"
		snippet["banDurationSeconds"] = command.DurationSeconds
	}
	var response struct {
		ID string `json:"id"`
	}
	if err := provider.request(ctx, source, http.MethodPost, "/liveChat/bans", url.Values{"part": {"snippet"}}, map[string]any{"snippet": snippet}, &response, "YouTube rejected the chat command"); err != nil {
		return ProviderCommandSuccess{}, err
	}
	if response.ID == "" {
		return ProviderCommandSuccess{}, &ProviderError{Type: "provider unavailable", Detail: "YouTube returned an invalid ban", Cause: errors.New("ban id missing")}
	}
	return ProviderCommandSuccess{ProviderBanID: response.ID}, nil
}

func (provider *YoutubeProvider) request(ctx context.Context, source ConnectedSource, method, path string, query url.Values, body any, target any, detail string) error {
	if source.Credentials.AccessToken == "" {
		return &ProviderError{Type: "provider unauthorized", Detail: "YouTube authorization is required"}
	}
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return operationError(detail, err)
		}
		reader = bytes.NewReader(encoded)
	}
	rawURL := provider.apiURL + path
	if len(query) > 0 {
		rawURL += "?" + query.Encode()
	}
	request, err := http.NewRequestWithContext(ctx, method, rawURL, reader)
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
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		_, _ = io.Copy(io.Discard, response.Body)
		return operationError(detail, &ProviderHTTPError{Status: response.StatusCode})
	}
	if target == nil {
		_, _ = io.Copy(io.Discard, response.Body)
		return nil
	}
	if err := json.NewDecoder(response.Body).Decode(target); err != nil {
		return operationError(detail, err)
	}
	return nil
}

func providerErrorType(err error) string {
	var providerError *ProviderError
	if errors.As(err, &providerError) {
		return providerError.Type
	}
	return ""
}

var _ Provider = (*YoutubeProvider)(nil)
