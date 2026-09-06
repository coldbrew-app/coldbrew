package chat

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

func vkVideoTestSource() ConnectedSource {
	source := connectedSource("019c58be-a09e-7000-8000-000000000005", "vk_video", CapabilityRead)
	source.Source.ProviderSourceID = "123"
	source.Source.ConnectionID = "019c58be-a09e-7000-8000-000000000006"
	source.Credentials = ProviderCredentials{AccessToken: "access-token", RefreshToken: "refresh-token", DeviceID: "device-1", Scopes: []string{"video"}, TokenVersion: 1}
	return source
}

func TestVKVideoMessageNormalizesUserAndEncodedLongPollEvents(t *testing.T) {
	source := vkVideoTestSource()
	encoded, _ := json.Marshal(`{"type":"video_comment_new","comment":{"id":77,"from_id":42,"text":"Привет","date":1788681600},"user":{"id":42,"first_name":"Иван","last_name":"Иванов"}}<br>1`)
	message, ok := vkVideoMessage(source, encoded)
	if !ok || message.ID != "77" || message.Author.ID != "42" || message.Author.DisplayName != "Иван Иванов" || message.Text != "Привет" || message.Provider != "vk_video" {
		t.Fatalf("message=%#v ok=%v", message, ok)
	}
}

func TestVKVideoMessageNormalizesCommunityAuthor(t *testing.T) {
	raw := json.RawMessage(`{"type":"video_special_comment_new","comment":{"id":"88","from_id":"-12","text":"Эфир","date":1788681600},"group":{"id":12,"name":"Канал"}}`)
	message, ok := vkVideoMessage(vkVideoTestSource(), raw)
	if !ok || message.Author.ID != "-12" || message.Author.DisplayName != "Канал" {
		t.Fatalf("message=%#v ok=%v", message, ok)
	}
}

func TestVKVideoStreamDiscoversBroadcastAndReadsLongPoll(t *testing.T) {
	client := &http.Client{Transport: oauthRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.URL.Path != "/longpoll" && request.URL.Query().Get("access_token") != "access-token" {
			t.Fatalf("missing authorization: %s", request.URL)
		}
		switch request.URL.Path {
		case "/method/video.get":
			if request.URL.Query().Get("owner_id") != "123" || request.URL.Query().Get("v") != vkAPIVersion {
				t.Fatalf("video.get query = %s", request.URL.RawQuery)
			}
			return vkVideoResponse(`{"response":{"count":1,"items":[{"id":456,"owner_id":123,"live":1}]}}`), nil
		case "/method/video.getLongPollServer":
			return vkVideoResponse(`{"response":{"url":"https://lp.vk.ru/longpoll?ts=1"}}`), nil
		case "/longpoll":
			return vkVideoResponse(`{"ts":2,"events":[{"type":"video_comment_new","comment":{"id":77,"from_id":42,"text":"Привет","date":1788681600},"user":{"id":42,"first_name":"Иван","last_name":"Иванов"}}]}`), nil
		default:
			t.Fatalf("unexpected request: %s", request.URL)
			return nil, nil
		}
	})}

	provider := NewVKVideoProvider(client)
	provider.apiURL = "https://api.test/method"
	ctx, cancel := context.WithCancel(context.Background())
	events, providerErrors := provider.Stream(ctx, vkVideoTestSource())
	connecting := <-events
	live := <-events
	message := <-events
	if connecting.State != "connecting" || live.State != "live" || message.Message == nil || message.Message.ID != "77" || message.Message.Author.DisplayName != "Иван Иванов" {
		t.Fatalf("connecting=%#v live=%#v message=%#v", connecting, live, message)
	}
	cancel()
	for err := range providerErrors {
		if err != nil && !strings.Contains(err.Error(), "context canceled") {
			t.Fatalf("provider error = %v", err)
		}
	}
}

func TestVKVideoStreamStaysOfflineUntilCancelled(t *testing.T) {
	client := &http.Client{Transport: oauthRoundTripFunc(func(*http.Request) (*http.Response, error) {
		return vkVideoResponse(`{"response":{"count":0,"items":[]}}`), nil
	})}
	provider := NewVKVideoProvider(client)
	provider.apiURL = "https://api.test/method"
	ctx, cancel := context.WithCancel(context.Background())
	events, providerErrors := provider.Stream(ctx, vkVideoTestSource())
	if (<-events).State != "connecting" || (<-events).State != "offline" {
		t.Fatal("unexpected state sequence")
	}
	cancel()
	for range providerErrors {
	}
}

func vkVideoResponse(body string) *http.Response {
	return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}
}

func TestVKVideoRejectsUntrustedLongPollURL(t *testing.T) {
	provider := NewVKVideoProvider(http.DefaultClient)
	for _, rawURL := range []string{"http://lp.vk.ru/poll", "https://example.com/poll", "https://user@lp.vk.ru/poll"} {
		parsed, err := url.Parse(rawURL)
		if err != nil {
			t.Fatal(err)
		}
		if provider.validLongPollURL(parsed) {
			t.Fatalf("accepted URL %s", rawURL)
		}
	}
	allowed, _ := url.Parse("https://lp.vk.ru/poll")
	if !provider.validLongPollURL(allowed) {
		t.Fatal("rejected VK long-poll URL")
	}
}

func TestVKVideoReadOnlyCommandsAreRejected(t *testing.T) {
	provider := NewVKVideoProvider(http.DefaultClient)
	if err := provider.SendMessage(context.Background(), vkVideoTestSource(), "hello"); err == nil {
		t.Fatal("expected send to be rejected")
	}
	if _, err := provider.Moderate(context.Background(), vkVideoTestSource(), ModerationCommand{}, ""); err == nil {
		t.Fatal("expected moderation to be rejected")
	}
}
