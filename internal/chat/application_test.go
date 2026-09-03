package chat

import (
	"context"
	"errors"
	"reflect"
	"sync"
	"testing"
	"time"
)

const (
	youtubeSourceID = "00000000-0000-4000-8000-000000000001"
	twitchSourceID  = "00000000-0000-4000-8000-000000000002"
	boostySourceID  = "00000000-0000-4000-8000-000000000003"
)

type fakeRepository struct {
	sources []ConnectedSource
	mu      sync.Mutex
	audit   []AuditEntry
}

func (repository *fakeRepository) GetConfig(context.Context, int) (Config, error) {
	return Config{}, nil
}
func (repository *fakeRepository) GetEnabledSources(context.Context, int) ([]ConnectedSource, error) {
	return repository.sources, nil
}
func (repository *fakeRepository) GetSource(_ context.Context, _ int, sourceID string) (*ConnectedSource, error) {
	for _, source := range repository.sources {
		if source.Source.SourceID == sourceID {
			copy := source
			return &copy, nil
		}
	}
	return nil, nil
}
func (repository *fakeRepository) GetProviderBanID(context.Context, string, string) (string, error) {
	return "", nil
}
func (repository *fakeRepository) SaveProviderBanID(context.Context, string, string, string) error {
	return nil
}
func (repository *fakeRepository) DeleteProviderBanID(context.Context, string, string) error {
	return nil
}
func (repository *fakeRepository) RecordAction(_ context.Context, entry AuditEntry) error {
	repository.mu.Lock()
	defer repository.mu.Unlock()
	repository.audit = append(repository.audit, entry)
	return nil
}

type fakeBroker struct {
	mu        sync.Mutex
	published []StreamEvent
}

func (broker *fakeBroker) Publish(_ context.Context, _ int, event StreamEvent, _ string) error {
	broker.mu.Lock()
	defer broker.mu.Unlock()
	broker.published = append(broker.published, event)
	return nil
}
func (*fakeBroker) Stream(context.Context, int) <-chan StreamEvent {
	stream := make(chan StreamEvent)
	close(stream)
	return stream
}

type fakeCollectorControl struct{ refreshes []string }

func (control *fakeCollectorControl) RequestRefresh(_ context.Context, sourceID string) error {
	control.refreshes = append(control.refreshes, sourceID)
	return nil
}

type fakeProvider struct {
	name     string
	send     func(string) error
	moderate func(ModerationCommand) (ProviderCommandSuccess, error)
}

func (provider *fakeProvider) Name() string { return provider.name }
func (*fakeProvider) Collection() string    { return "pull" }
func (*fakeProvider) Stream(context.Context, ConnectedSource) (<-chan StreamEvent, <-chan error) {
	events := make(chan StreamEvent)
	errors := make(chan error)
	close(events)
	close(errors)
	return events, errors
}
func (provider *fakeProvider) SendMessage(_ context.Context, _ ConnectedSource, text string) error {
	return provider.send(text)
}
func (provider *fakeProvider) Moderate(_ context.Context, _ ConnectedSource, command ModerationCommand, _ string) (ProviderCommandSuccess, error) {
	return provider.moderate(command)
}

func connectedSource(id, provider string, capabilities ...Capability) ConnectedSource {
	return ConnectedSource{Source: Source{SourceID: id, ConnectionID: "connection-" + id, Provider: provider, ProviderSourceID: provider + "-channel", DisplayName: provider + " channel", SourceURL: "https://example.com/" + provider, Enabled: true}, Capabilities: capabilities, Credentials: ProviderCredentials{TokenVersion: 1}}
}

func setupApplication() (*Application, *fakeRepository, *fakeBroker, *fakeCollectorControl, *[]string) {
	repository := &fakeRepository{sources: []ConnectedSource{
		connectedSource(youtubeSourceID, "youtube", CapabilityRead, CapabilitySendMessage, CapabilityDeleteMessage),
		connectedSource(twitchSourceID, "twitch", CapabilityRead, CapabilitySendMessage),
		connectedSource(boostySourceID, "boosty", CapabilityRead),
	}}
	broker := &fakeBroker{}
	control := &fakeCollectorControl{}
	sends := make([]string, 0)
	var sendsMutex sync.Mutex
	youtube := &fakeProvider{name: "youtube", send: func(text string) error {
		sendsMutex.Lock()
		defer sendsMutex.Unlock()
		sends = append(sends, "youtube:"+text)
		return nil
	}, moderate: func(ModerationCommand) (ProviderCommandSuccess, error) { return ProviderCommandSuccess{}, nil }}
	twitch := &fakeProvider{name: "twitch", send: func(text string) error {
		sendsMutex.Lock()
		defer sendsMutex.Unlock()
		sends = append(sends, "twitch:"+text)
		return &ProviderError{Type: "provider unavailable", Detail: "Twitch unavailable"}
	}, moderate: func(ModerationCommand) (ProviderCommandSuccess, error) { return ProviderCommandSuccess{}, nil }}
	return NewApplication(repository, broker, []Provider{youtube, twitch}, control), repository, broker, control, &sends
}

func TestApplicationBroadcastsWithOneResultPerSource(t *testing.T) {
	application, repository, _, _, sends := setupApplication()
	result, err := application.Broadcast(context.Background(), 42, " hello ")
	if err != nil {
		t.Fatal(err)
	}
	expected := []CommandResult{{SourceID: youtubeSourceID, Status: "succeeded"}, {SourceID: twitchSourceID, Status: "failed", Detail: "Twitch unavailable"}, {SourceID: boostySourceID, Status: "unsupported", Detail: "This provider connection is read-only"}}
	if !reflect.DeepEqual(result.Results, expected) {
		t.Fatalf("results = %#v; want %#v", result.Results, expected)
	}
	if len(*sends) != 2 || len(repository.audit) != 3 {
		t.Fatalf("sends=%v audit=%#v", *sends, repository.audit)
	}
	for _, entry := range repository.audit {
		if entry.ActionType != "send_message" {
			t.Fatalf("unexpected audit entry: %#v", entry)
		}
	}
}

func TestApplicationBroadcastsConcurrently(t *testing.T) {
	sources := []ConnectedSource{
		connectedSource(youtubeSourceID, "youtube", CapabilitySendMessage),
		connectedSource(twitchSourceID, "twitch", CapabilitySendMessage),
	}
	repository := &fakeRepository{sources: sources}
	started := make(chan string, 2)
	release := make(chan struct{})
	provider := func(name string) Provider {
		return &fakeProvider{name: name, send: func(string) error {
			started <- name
			<-release
			return nil
		}, moderate: func(ModerationCommand) (ProviderCommandSuccess, error) { return ProviderCommandSuccess{}, nil }}
	}
	application := NewApplication(repository, &fakeBroker{}, []Provider{provider("youtube"), provider("twitch")}, &fakeCollectorControl{})
	finished := make(chan error, 1)
	go func() {
		_, err := application.Broadcast(context.Background(), 42, "hello")
		finished <- err
	}()
	for range 2 {
		select {
		case <-started:
		case <-time.After(time.Second):
			close(release)
			t.Fatal("broadcast sends did not start concurrently")
		}
	}
	close(release)
	if err := <-finished; err != nil {
		t.Fatal(err)
	}
}

func TestApplicationPublishesDeletionAfterConfirmation(t *testing.T) {
	application, _, broker, _, _ := setupApplication()
	result, err := application.Moderate(context.Background(), 42, ModerationCommand{Type: "delete_message", SourceID: youtubeSourceID, MessageID: "message-1"})
	if err != nil {
		t.Fatal(err)
	}
	if result != (CommandResult{SourceID: youtubeSourceID, Status: "succeeded"}) {
		t.Fatalf("unexpected result: %#v", result)
	}
	expected := []StreamEvent{{Type: "message_deleted", SourceID: youtubeSourceID, MessageID: "message-1"}}
	if !reflect.DeepEqual(broker.published, expected) {
		t.Fatalf("published = %#v; want %#v", broker.published, expected)
	}
}

func TestApplicationRequestsYouTubeRefresh(t *testing.T) {
	application, _, _, control, _ := setupApplication()
	if err := application.RefreshSource(context.Background(), 42, youtubeSourceID); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(control.refreshes, []string{youtubeSourceID}) {
		t.Fatalf("refreshes = %v", control.refreshes)
	}
}

func TestApplicationRejectsRefreshForOtherProviders(t *testing.T) {
	application, _, _, control, _ := setupApplication()
	err := application.RefreshSource(context.Background(), 42, twitchSourceID)
	var applicationError *ApplicationError
	if !errors.As(err, &applicationError) || applicationError.Type != "chat source refresh unsupported" || len(control.refreshes) != 0 {
		t.Fatalf("unexpected error=%v refreshes=%v", err, control.refreshes)
	}
}

func TestApplicationRejectsEmptyBroadcast(t *testing.T) {
	application, _, _, _, _ := setupApplication()
	_, err := application.Broadcast(context.Background(), 42, "  ")
	var applicationError *ApplicationError
	if !errors.As(err, &applicationError) || applicationError.Type != "invalid chat message" {
		t.Fatalf("expected invalid message, got %v", err)
	}
}

func TestApplicationNormalizesModerationReasonAtInputSeam(t *testing.T) {
	repository := &fakeRepository{sources: []ConnectedSource{connectedSource(youtubeSourceID, "youtube", CapabilityBanUser)}}
	var received ModerationCommand
	provider := &fakeProvider{name: "youtube", send: func(string) error { return nil }, moderate: func(command ModerationCommand) (ProviderCommandSuccess, error) {
		received = command
		return ProviderCommandSuccess{}, nil
	}}
	application := NewApplication(repository, &fakeBroker{}, []Provider{provider}, &fakeCollectorControl{})
	_, err := application.Moderate(context.Background(), 42, ModerationCommand{Type: "ban_user", SourceID: youtubeSourceID, ProviderUserID: "viewer-1", Reason: "  repeated spam  "})
	if err != nil {
		t.Fatal(err)
	}
	if received.Reason != "repeated spam" || len(repository.audit) != 1 || repository.audit[0].Reason != "repeated spam" {
		t.Fatalf("command=%#v audit=%#v", received, repository.audit)
	}
}
