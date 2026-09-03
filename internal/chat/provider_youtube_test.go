package chat

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/lebedev-nikita/coldbrew/internal/youtubechatpb"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

func youtubeTestSource() ConnectedSource {
	source := connectedSource(youtubeSourceID, "youtube", CapabilityRead, CapabilitySendMessage, CapabilityDeleteMessage, CapabilityTimeoutUser, CapabilityBanUser, CapabilityUnbanUser)
	source.Source.ProviderSourceID = "channel-1"
	source.Credentials = ProviderCredentials{AccessToken: "access-token", RefreshToken: "refresh-token", Scopes: []string{"https://www.googleapis.com/auth/youtube.force-ssl"}, TokenVersion: 1}
	return source
}

func TestYoutubeStreamStaysOfflineUntilCancelled(t *testing.T) {
	var requests int
	client := &http.Client{Transport: oauthRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		requests++
		if request.URL.Query().Get("broadcastType") != "all" {
			t.Fatalf("broadcastType = %q", request.URL.Query().Get("broadcastType"))
		}
		return youtubeResponse(http.StatusOK, `{"items":[]}`), nil
	})}
	provider := NewYoutubeProvider(client)
	ctx, cancel := context.WithCancel(context.Background())
	events, providerErrors := provider.Stream(ctx, youtubeTestSource())
	if event := <-events; event.State != "connecting" {
		t.Fatalf("first event = %#v", event)
	}
	if event := <-events; event.State != "offline" {
		t.Fatalf("second event = %#v", event)
	}
	if requests != 1 {
		t.Fatalf("requests = %d", requests)
	}
	cancel()
	for range providerErrors {
	}
}

func TestYoutubeLiveChatBuildsAuthenticatedStreamingRequest(t *testing.T) {
	request := youtubeLiveChatRequest(youtubeLiveChatCursor{LiveChatID: "live-chat-1", PageToken: "page-2"})
	if request.GetLiveChatId() != "live-chat-1" || request.GetPageToken() != "page-2" || strings.Join(request.GetPart(), ",") != "snippet,authorDetails" {
		t.Fatalf("request = %#v", request)
	}
	values, ok := metadata.FromOutgoingContext(youtubeLiveChatContext(context.Background(), "access-token"))
	if !ok || strings.Join(values.Get("authorization"), ",") != "Bearer access-token" {
		t.Fatalf("metadata = %#v", values)
	}
}

func TestYoutubeStreamPollsDiscoveredChatAndNormalizesMessages(t *testing.T) {
	client := &http.Client{Transport: oauthRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		return youtubeResponse(http.StatusOK, `{"items":[{"snippet":{"liveChatId":"live-chat-1"}}]}`), nil
	})}
	provider := NewYoutubeProvider(client)
	provider.open = func(_ context.Context, cursor youtubeLiveChatCursor, token string) (youtubeLiveChatSession, error) {
		if cursor.LiveChatID != "live-chat-1" || cursor.PageToken != "" || token != "access-token" {
			t.Fatalf("open cursor=%#v token=%q", cursor, token)
		}
		return &fakeYoutubeLiveChatSession{responses: []*youtubechatpb.LiveChatMessageListResponse{{
			NextPageToken: proto.String("page-2"),
			OfflineAt:     proto.String("2026-08-31T10:01:00Z"),
			Items:         []*youtubechatpb.LiveChatMessage{youtubeTextMessage("message-1", "author-1", "Viewer", "hello", "2026-08-31T10:00:00Z")},
		}}}, nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	events, providerErrors := provider.Stream(ctx, youtubeTestSource())
	discovering := <-events
	connecting := <-events
	live := <-events
	message := <-events
	offline := <-events
	if discovering.State != "connecting" || connecting.State != "connecting" || live.State != "live" || offline.State != "offline" {
		t.Fatalf("states: %#v %#v %#v %#v", discovering, connecting, live, offline)
	}
	if message.Message == nil || message.Message.ID != "message-1" || message.Message.Author.ID != "author-1" || message.Message.Text != "hello" {
		t.Fatalf("message = %#v", message)
	}
	cancel()
	for range providerErrors {
	}
}

func TestYoutubeStreamContinuesFromLastPageToken(t *testing.T) {
	client := &http.Client{Transport: oauthRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		return youtubeResponse(http.StatusOK, `{"items":[{"snippet":{"liveChatId":"live-chat-1"}}]}`), nil
	})}
	provider := NewYoutubeProvider(client)
	var cursors []youtubeLiveChatCursor
	var waits []time.Duration
	provider.open = func(_ context.Context, cursor youtubeLiveChatCursor, _ string) (youtubeLiveChatSession, error) {
		cursors = append(cursors, cursor)
		if len(cursors) == 1 {
			return &fakeYoutubeLiveChatSession{responses: []*youtubechatpb.LiveChatMessageListResponse{{NextPageToken: proto.String("page-2")}}}, nil
		}
		if len(cursors) == 2 {
			return &fakeYoutubeLiveChatSession{responses: []*youtubechatpb.LiveChatMessageListResponse{{NextPageToken: proto.String("page-3")}}}, nil
		}
		return &fakeYoutubeLiveChatSession{responses: []*youtubechatpb.LiveChatMessageListResponse{{OfflineAt: proto.String("2026-08-31T10:01:00Z")}}}, nil
	}
	provider.wait = func(_ context.Context, duration time.Duration) bool {
		waits = append(waits, duration)
		return true
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	events, providerErrors := provider.Stream(ctx, youtubeTestSource())
	states := []string{(<-events).State, (<-events).State, (<-events).State, (<-events).State, (<-events).State, (<-events).State, (<-events).State, (<-events).State}
	if strings.Join(states, ",") != "connecting,connecting,live,connecting,live,connecting,live,offline" {
		t.Fatalf("states = %#v", states)
	}
	if len(cursors) != 3 || cursors[0].PageToken != "" || cursors[1].PageToken != "page-2" || cursors[2].PageToken != "page-3" {
		t.Fatalf("cursors = %#v", cursors)
	}
	if len(waits) != 2 || waits[0] != youtubeDiscoveryRetryStart || waits[1] != youtubeDiscoveryRetryStart {
		t.Fatalf("waits = %#v", waits)
	}
	cancel()
	for range providerErrors {
	}
}

func TestYoutubeStreamStopsAfterUnauthorizedFailure(t *testing.T) {
	requests := 0
	client := &http.Client{Transport: oauthRoundTripFunc(func(*http.Request) (*http.Response, error) {
		requests++
		return youtubeResponse(http.StatusUnauthorized, `{}`), nil
	})}
	provider := NewYoutubeProvider(client)
	provider.wait = func(context.Context, time.Duration) bool {
		t.Fatal("unauthorized stream should not retry")
		return false
	}
	ctx, cancel := context.WithCancel(context.Background())
	events, providerErrors := provider.Stream(ctx, youtubeTestSource())
	if (<-events).State != "connecting" {
		t.Fatal("missing connecting state")
	}
	err := <-providerErrors
	providerError, ok := err.(*ProviderError)
	if !ok || providerError.Type != "provider unauthorized" || requests != 1 {
		t.Fatalf("error=%v requests=%d", err, requests)
	}
	cancel()
	for range providerErrors {
	}
}

func TestYoutubeLiveChatStopsAfterUnauthorizedFailure(t *testing.T) {
	client := &http.Client{Transport: oauthRoundTripFunc(func(*http.Request) (*http.Response, error) {
		return youtubeResponse(http.StatusOK, `{"items":[{"snippet":{"liveChatId":"live-chat-1"}}]}`), nil
	})}
	provider := NewYoutubeProvider(client)
	provider.open = func(context.Context, youtubeLiveChatCursor, string) (youtubeLiveChatSession, error) {
		return nil, status.Error(codes.Unauthenticated, "expired")
	}
	provider.wait = func(context.Context, time.Duration) bool {
		t.Fatal("unauthorized live chat should not retry")
		return false
	}
	ctx, cancel := context.WithCancel(context.Background())
	events, providerErrors := provider.Stream(ctx, youtubeTestSource())
	discovering := <-events
	connecting := <-events
	live := <-events
	if discovering.State != "connecting" || connecting.State != "connecting" || live.State != "live" {
		t.Fatal("unexpected YouTube state sequence")
	}
	err := <-providerErrors
	if typed, ok := err.(*ProviderError); !ok || typed.Type != "provider unauthorized" {
		t.Fatalf("error = %v", err)
	}
	cancel()
	for range events {
	}
}

func TestYoutubeSendMessageUsesDiscoveredChat(t *testing.T) {
	var sent map[string]any
	client := &http.Client{Transport: oauthRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.Method == http.MethodGet {
			return youtubeResponse(http.StatusOK, `{"items":[{"snippet":{"liveChatId":"live-chat-1"}}]}`), nil
		}
		if request.Method != http.MethodPost || request.URL.Query().Get("part") != "snippet" {
			t.Fatalf("request = %s %s", request.Method, request.URL)
		}
		if err := json.NewDecoder(request.Body).Decode(&sent); err != nil {
			t.Fatal(err)
		}
		return youtubeResponse(http.StatusOK, ``), nil
	})}
	if err := NewYoutubeProvider(client).SendMessage(context.Background(), youtubeTestSource(), "hello"); err != nil {
		t.Fatal(err)
	}
	snippet := sent["snippet"].(map[string]any)
	if snippet["liveChatId"] != "live-chat-1" || snippet["type"] != "textMessageEvent" {
		t.Fatalf("body = %#v", sent)
	}
}

func TestYoutubeModerationReturnsAndUsesBanID(t *testing.T) {
	client := &http.Client{Transport: oauthRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		switch request.Method {
		case http.MethodGet:
			return youtubeResponse(http.StatusOK, `{"items":[{"snippet":{"liveChatId":"live-chat-1"}}]}`), nil
		case http.MethodPost:
			return youtubeResponse(http.StatusOK, `{"id":"ban-1"}`), nil
		case http.MethodDelete:
			if request.URL.Query().Get("id") != "ban-1" {
				t.Fatalf("ban id = %q", request.URL.Query().Get("id"))
			}
			return youtubeResponse(http.StatusNoContent, ``), nil
		default:
			t.Fatalf("method = %s", request.Method)
			return nil, nil
		}
	})}
	provider := NewYoutubeProvider(client)
	source := youtubeTestSource()
	success, err := provider.Moderate(context.Background(), source, ModerationCommand{Type: "timeout_user", ProviderUserID: "author-1", DurationSeconds: 60}, "")
	if err != nil || success.ProviderBanID != "ban-1" {
		t.Fatalf("success=%#v err=%v", success, err)
	}
	if _, err := provider.Moderate(context.Background(), source, ModerationCommand{Type: "unban_user", ProviderUserID: "author-1"}, success.ProviderBanID); err != nil {
		t.Fatal(err)
	}
}

func TestYoutubeMapsUnauthorizedResponse(t *testing.T) {
	client := &http.Client{Transport: oauthRoundTripFunc(func(*http.Request) (*http.Response, error) {
		return youtubeResponse(http.StatusUnauthorized, `{}`), nil
	})}
	err := NewYoutubeProvider(client).SendMessage(context.Background(), youtubeTestSource(), "hello")
	providerError, ok := err.(*ProviderError)
	if !ok || providerError.Type != "provider unauthorized" {
		t.Fatalf("error = %v", err)
	}
}

func TestYoutubeMessageRejectsIncompleteOrNonTextItems(t *testing.T) {
	nonText := youtubeTextMessage("message-1", "author-1", "Viewer", "hello", time.Now().Format(time.RFC3339Nano))
	nonText.Snippet.Type = youtubechatpb.LiveChatMessageSnippet_TypeWrapper_SUPER_CHAT_EVENT.Enum()
	for _, item := range []*youtubechatpb.LiveChatMessage{nil, {}, nonText} {
		if _, ok := youtubeMessage(youtubeTestSource(), item); ok {
			t.Fatalf("accepted item: %#v", item)
		}
	}
}

type fakeYoutubeLiveChatSession struct {
	responses []*youtubechatpb.LiveChatMessageListResponse
	index     int
	closeErr  error
}

func (session *fakeYoutubeLiveChatSession) Recv() (*youtubechatpb.LiveChatMessageListResponse, error) {
	if session.index >= len(session.responses) {
		return nil, io.EOF
	}
	response := session.responses[session.index]
	session.index++
	return response, nil
}

func (session *fakeYoutubeLiveChatSession) Close() error { return session.closeErr }

func youtubeTextMessage(id, authorID, author, text, occurredAt string) *youtubechatpb.LiveChatMessage {
	return &youtubechatpb.LiveChatMessage{
		Id: proto.String(id),
		Snippet: &youtubechatpb.LiveChatMessageSnippet{
			Type:        youtubechatpb.LiveChatMessageSnippet_TypeWrapper_TEXT_MESSAGE_EVENT.Enum(),
			PublishedAt: proto.String(occurredAt),
			DisplayedContent: &youtubechatpb.LiveChatMessageSnippet_TextMessageDetails{
				TextMessageDetails: &youtubechatpb.LiveChatTextMessageDetails{MessageText: proto.String(text)},
			},
		},
		AuthorDetails: &youtubechatpb.LiveChatMessageAuthorDetails{ChannelId: proto.String(authorID), DisplayName: proto.String(author)},
	}
}

func youtubeResponse(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}
}
