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

	"github.com/coder/websocket"
)

const twitchReconnectDelay = 1500 * time.Millisecond

type TwitchProvider struct {
	clientID     string
	clientSecret string
	client       *http.Client
	apiURL       string
	dial         func(context.Context, string) (twitchSocket, error)
}

type twitchSocket interface {
	Read(context.Context) (websocket.MessageType, []byte, error)
	Close(websocket.StatusCode, string) error
}

func NewTwitchProvider(clientID, clientSecret string, client *http.Client) *TwitchProvider {
	return &TwitchProvider{clientID: clientID, clientSecret: clientSecret, client: client, apiURL: "https://api.twitch.tv", dial: func(ctx context.Context, rawURL string) (twitchSocket, error) {
		connection, _, err := websocket.Dial(ctx, rawURL, nil)
		return connection, err
	}}
}

func (*TwitchProvider) Name() string       { return "twitch" }
func (*TwitchProvider) Collection() string { return "pull" }

func (provider *TwitchProvider) Stream(ctx context.Context, source ConnectedSource) (<-chan StreamEvent, <-chan error) {
	events := make(chan StreamEvent)
	errorsChannel := make(chan error)
	go func() {
		defer close(events)
		defer close(errorsChannel)
		if source.Credentials.AccessToken == "" || source.Credentials.RefreshToken == "" {
			sendProviderError(ctx, errorsChannel, &ProviderError{Type: "provider unauthorized", Detail: "Twitch authorization is required"})
			return
		}
		sendStreamEvent(ctx, events, StreamEvent{Type: "state", SourceID: source.Source.SourceID, State: "connecting"})
		reconnectURL := "wss://eventsub.wss.twitch.tv/ws"
		for ctx.Err() == nil {
			connection, err := provider.dial(ctx, reconnectURL)
			if err != nil {
				sendProviderError(ctx, errorsChannel, operationError("Twitch chat connection failed", err))
				if !waitFor(ctx, twitchReconnectDelay) {
					return
				}
				reconnectURL = "wss://eventsub.wss.twitch.tv/ws"
				continue
			}
			nextURL, immediate := provider.readTwitchSocket(ctx, connection, source, events, errorsChannel)
			_ = connection.Close(websocket.StatusNormalClosure, "")
			if ctx.Err() != nil {
				return
			}
			if immediate {
				reconnectURL = nextURL
				continue
			}
			reconnectURL = "wss://eventsub.wss.twitch.tv/ws"
			if !waitFor(ctx, twitchReconnectDelay) {
				return
			}
		}
	}()
	return events, errorsChannel
}

func (provider *TwitchProvider) readTwitchSocket(ctx context.Context, connection twitchSocket, source ConnectedSource, events chan<- StreamEvent, errorsChannel chan<- error) (string, bool) {
	for ctx.Err() == nil {
		_, body, err := connection.Read(ctx)
		if err != nil {
			if ctx.Err() == nil {
				sendProviderError(ctx, errorsChannel, operationError("Twitch chat connection failed", err))
			}
			return "", false
		}
		event, err := decodeTwitchEvent(body)
		if err != nil {
			sendProviderError(ctx, errorsChannel, operationError("Twitch chat connection failed", err))
			return "", false
		}
		if event == nil {
			continue
		}
		switch event.Type {
		case "welcome":
			if err := provider.createTwitchSubscription(ctx, source, event.SessionID); err != nil {
				sendProviderError(ctx, errorsChannel, err)
				return "", false
			}
			sendStreamEvent(ctx, events, StreamEvent{Type: "state", SourceID: source.Source.SourceID, State: "live"})
		case "reconnect":
			return event.ReconnectURL, true
		case "revocation":
			sendProviderError(ctx, errorsChannel, &ProviderError{Type: "provider unavailable", Detail: event.Reason})
		case "message":
			message := Message{ID: event.MessageID, SourceID: source.Source.SourceID, ConnectionID: source.Source.ConnectionID, Provider: "twitch", Author: Author{ID: event.AuthorID, DisplayName: event.Author}, Text: event.Text, OccurredAt: event.OccurredAt}
			sendStreamEvent(ctx, events, StreamEvent{Type: "message", Message: &message})
		}
	}
	return "", false
}

type twitchEvent struct {
	Type          string
	SessionID     string
	ReconnectURL  string
	Reason        string
	BroadcasterID string
	MessageID     string
	AuthorID      string
	Author        string
	Text          string
	OccurredAt    time.Time
}

func decodeTwitchEvent(body []byte) (*twitchEvent, error) {
	var envelope struct {
		Metadata struct {
			MessageType      string `json:"message_type"`
			MessageTimestamp string `json:"message_timestamp"`
		} `json:"metadata"`
		Payload json.RawMessage `json:"payload"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil || envelope.Metadata.MessageType == "" {
		return nil, errors.New("Could not decode the Twitch socket message")
	}
	switch envelope.Metadata.MessageType {
	case "session_keepalive":
		return nil, nil
	case "session_welcome":
		var payload struct {
			Session struct {
				ID string `json:"id"`
			} `json:"session"`
		}
		if json.Unmarshal(envelope.Payload, &payload) != nil || payload.Session.ID == "" {
			return nil, errors.New("Could not decode the Twitch socket message")
		}
		return &twitchEvent{Type: "welcome", SessionID: payload.Session.ID}, nil
	case "session_reconnect":
		var payload struct {
			Session struct {
				ReconnectURL string `json:"reconnect_url"`
			} `json:"session"`
		}
		if json.Unmarshal(envelope.Payload, &payload) != nil || payload.Session.ReconnectURL == "" {
			return nil, errors.New("Could not decode the Twitch socket message")
		}
		return &twitchEvent{Type: "reconnect", ReconnectURL: payload.Session.ReconnectURL}, nil
	case "revocation":
		var payload struct {
			Subscription struct {
				Status    string `json:"status"`
				Condition struct {
					BroadcasterUserID string `json:"broadcaster_user_id"`
				} `json:"condition"`
			} `json:"subscription"`
		}
		if json.Unmarshal(envelope.Payload, &payload) != nil || payload.Subscription.Status == "" || payload.Subscription.Condition.BroadcasterUserID == "" {
			return nil, errors.New("Could not decode the Twitch socket message")
		}
		return &twitchEvent{Type: "revocation", Reason: payload.Subscription.Status, BroadcasterID: payload.Subscription.Condition.BroadcasterUserID}, nil
	case "notification":
		var payload struct {
			Event struct {
				MessageID       string `json:"message_id"`
				ChatterUserID   string `json:"chatter_user_id"`
				ChatterUserName string `json:"chatter_user_name"`
				Message         struct {
					Text string `json:"text"`
				} `json:"message"`
			} `json:"event"`
		}
		if json.Unmarshal(envelope.Payload, &payload) != nil || payload.Event.MessageID == "" || payload.Event.ChatterUserID == "" || payload.Event.ChatterUserName == "" {
			return nil, errors.New("Could not decode the Twitch socket message")
		}
		occurredAt, err := time.Parse(time.RFC3339Nano, envelope.Metadata.MessageTimestamp)
		if err != nil {
			return nil, errors.New("Could not decode the Twitch socket message")
		}
		return &twitchEvent{Type: "message", MessageID: payload.Event.MessageID, AuthorID: payload.Event.ChatterUserID, Author: payload.Event.ChatterUserName, Text: payload.Event.Message.Text, OccurredAt: occurredAt}, nil
	default:
		return nil, nil
	}
}

func (provider *TwitchProvider) createTwitchSubscription(ctx context.Context, source ConnectedSource, sessionID string) error {
	body := map[string]any{"type": "channel.chat.message", "version": "1", "condition": map[string]string{"broadcaster_user_id": source.Source.ProviderSourceID, "user_id": source.Source.ProviderSourceID}, "transport": map[string]string{"method": "websocket", "session_id": sessionID}}
	return provider.request(ctx, source, http.MethodPost, "/helix/eventsub/subscriptions", nil, body, nil, "Twitch rejected the chat subscription")
}

func (provider *TwitchProvider) SendMessage(ctx context.Context, source ConnectedSource, text string) error {
	body := map[string]any{"broadcaster_id": source.Source.ProviderSourceID, "sender_id": source.Source.ProviderSourceID, "message": text}
	var response struct {
		Data []struct {
			IsSent     bool `json:"is_sent"`
			DropReason *struct {
				Message string `json:"message"`
			} `json:"drop_reason"`
		} `json:"data"`
	}
	if err := provider.request(ctx, source, http.MethodPost, "/helix/chat/messages", nil, body, &response, "Twitch rejected the chat message"); err != nil {
		return err
	}
	if len(response.Data) == 0 || !response.Data[0].IsSent {
		detail := "Twitch did not deliver the chat message"
		if len(response.Data) > 0 && response.Data[0].DropReason != nil && response.Data[0].DropReason.Message != "" {
			detail = response.Data[0].DropReason.Message
		}
		return &ProviderError{Type: "provider rejected command", Detail: detail}
	}
	return nil
}

func (provider *TwitchProvider) Moderate(ctx context.Context, source ConnectedSource, command ModerationCommand, _ string) (ProviderCommandSuccess, error) {
	query := url.Values{"broadcaster_id": {source.Source.ProviderSourceID}, "moderator_id": {source.Source.ProviderSourceID}}
	path := "/helix/moderation/bans"
	method := http.MethodPost
	var body any = map[string]any{"data": map[string]any{"user_id": command.ProviderUserID}}
	detail := "Twitch rejected the moderation action"
	if command.Type == "delete_message" {
		path = "/helix/moderation/chat"
		method = http.MethodDelete
		query.Set("message_id", command.MessageID)
		body = nil
		detail = "Twitch rejected the message deletion"
	}
	if command.Type == "unban_user" {
		method = http.MethodDelete
		query.Set("user_id", command.ProviderUserID)
		body = nil
		detail = "Twitch rejected the unban"
	}
	if data, ok := body.(map[string]any); ok {
		inner := data["data"].(map[string]any)
		if command.Type == "timeout_user" {
			inner["duration"] = command.DurationSeconds
		}
		if command.Reason != "" {
			inner["reason"] = command.Reason
		}
	}
	return ProviderCommandSuccess{}, provider.request(ctx, source, method, path, query, body, nil, detail)
}

func (provider *TwitchProvider) request(ctx context.Context, source ConnectedSource, method, path string, query url.Values, body any, target any, detail string) error {
	if source.Credentials.AccessToken == "" {
		return &ProviderError{Type: "provider unauthorized", Detail: "Twitch authorization is required"}
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
	if query != nil {
		rawURL += "?" + query.Encode()
	}
	request, err := http.NewRequestWithContext(ctx, method, rawURL, reader)
	if err != nil {
		return operationError(detail, err)
	}
	request.Header.Set("Authorization", "Bearer "+source.Credentials.AccessToken)
	request.Header.Set("Client-Id", provider.clientID)
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
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
	if target != nil {
		if err := json.NewDecoder(response.Body).Decode(target); err != nil {
			return operationError(detail, err)
		}
	} else {
		_, _ = io.Copy(io.Discard, response.Body)
	}
	return nil
}

func sendProviderError(ctx context.Context, output chan<- error, err error) {
	select {
	case output <- err:
	case <-ctx.Done():
	}
}
func sendStreamEvent(ctx context.Context, output chan<- StreamEvent, event StreamEvent) {
	select {
	case output <- event:
	case <-ctx.Done():
	}
}

var _ Provider = (*TwitchProvider)(nil)
