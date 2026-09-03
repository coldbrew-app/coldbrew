package chat

import (
	"context"
	"reflect"
	"sync"
	"testing"
)

type collectorTestStore struct{ source OwnedConnectedSource }

func (store *collectorTestStore) GetAllEnabledSources(context.Context) ([]OwnedConnectedSource, error) {
	return []OwnedConnectedSource{store.source}, nil
}

type collectorTestLease struct{}

func (*collectorTestLease) Maintain(ctx context.Context) error { <-ctx.Done(); return nil }
func (*collectorTestLease) Release() error                     { return nil }

type collectorTestLeases struct{}

func (*collectorTestLeases) Acquire(context.Context, string, string) (CollectorLease, error) {
	return &collectorTestLease{}, nil
}

type collectorTestControl struct{ refreshes <-chan string }

func (control *collectorTestControl) Refreshes(context.Context) (<-chan string, error) {
	return control.refreshes, nil
}

type collectorTestBroker struct {
	mu      sync.Mutex
	events  []StreamEvent
	onEvent func(StreamEvent)
}

func (broker *collectorTestBroker) Publish(_ context.Context, _ int, event StreamEvent, _ string) error {
	broker.mu.Lock()
	broker.events = append(broker.events, event)
	broker.mu.Unlock()
	if broker.onEvent != nil {
		broker.onEvent(event)
	}
	return nil
}
func (*collectorTestBroker) Stream(context.Context, int) <-chan StreamEvent {
	output := make(chan StreamEvent)
	close(output)
	return output
}

type collectorTestProvider struct {
	stream func(context.Context) (<-chan StreamEvent, <-chan error)
}

func (*collectorTestProvider) Name() string       { return "youtube" }
func (*collectorTestProvider) Collection() string { return "pull" }
func (provider *collectorTestProvider) Stream(ctx context.Context, _ ConnectedSource) (<-chan StreamEvent, <-chan error) {
	return provider.stream(ctx)
}
func (*collectorTestProvider) SendMessage(context.Context, ConnectedSource, string) error { return nil }
func (*collectorTestProvider) Moderate(context.Context, ConnectedSource, ModerationCommand, string) (ProviderCommandSuccess, error) {
	return ProviderCommandSuccess{}, nil
}

func testOwnedSource() OwnedConnectedSource {
	return OwnedConnectedSource{UserID: 42, ConnectedSource: ConnectedSource{Source: Source{SourceID: youtubeSourceID, ConnectionID: "10000000-0000-4000-8000-000000000001", Provider: "youtube", ProviderSourceID: "channel-1", DisplayName: "Channel", SourceURL: "https://www.youtube.com/channel/channel-1", Enabled: true}, Capabilities: []Capability{CapabilityRead}, Credentials: ProviderCredentials{AccessToken: "token", TokenVersion: 1}}}
}

func TestCollectorsPublishErrorsAndContinue(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	refreshes := make(chan string)
	broker := &collectorTestBroker{}
	broker.onEvent = func(event StreamEvent) {
		if event.Type == "state" && event.State == "offline" {
			cancel()
		}
	}
	provider := &collectorTestProvider{stream: func(ctx context.Context) (<-chan StreamEvent, <-chan error) {
		events := make(chan StreamEvent)
		errorsChannel := make(chan error)
		go func() {
			defer close(events)
			defer close(errorsChannel)
			select {
			case errorsChannel <- &ProviderError{Type: "provider unavailable", Detail: "temporary"}:
			case <-ctx.Done():
				return
			}
			select {
			case events <- StreamEvent{Type: "state", SourceID: youtubeSourceID, State: "offline"}:
			case <-ctx.Done():
				return
			}
		}()
		return events, errorsChannel
	}}
	err := RunCollectors(ctx, &collectorTestStore{source: testOwnedSource()}, broker, &collectorTestLeases{}, &collectorTestControl{refreshes: refreshes}, []Provider{provider})
	if err != nil {
		t.Fatal(err)
	}
	expected := []StreamEvent{{Type: "state", SourceID: youtubeSourceID, State: "error", Detail: "temporary"}, {Type: "state", SourceID: youtubeSourceID, State: "offline"}}
	if !reflect.DeepEqual(broker.events, expected) {
		t.Fatalf("events = %#v; want %#v", broker.events, expected)
	}
}

func TestCollectorsRestartOnManualRefresh(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	refreshes := make(chan string, 1)
	broker := &collectorTestBroker{}
	starts := 0
	var startsMutex sync.Mutex
	provider := &collectorTestProvider{stream: func(ctx context.Context) (<-chan StreamEvent, <-chan error) {
		events := make(chan StreamEvent)
		errorsChannel := make(chan error)
		startsMutex.Lock()
		start := starts
		starts++
		startsMutex.Unlock()
		go func() {
			defer close(events)
			defer close(errorsChannel)
			state := "offline"
			if start > 0 {
				state = "live"
			}
			select {
			case events <- StreamEvent{Type: "state", SourceID: youtubeSourceID, State: state}:
			case <-ctx.Done():
				return
			}
			if start == 0 {
				<-ctx.Done()
			}
		}()
		return events, errorsChannel
	}}
	broker.onEvent = func(event StreamEvent) {
		if event.State == "offline" {
			refreshes <- youtubeSourceID
		}
		if event.State == "live" {
			cancel()
		}
	}
	if err := RunCollectors(ctx, &collectorTestStore{source: testOwnedSource()}, broker, &collectorTestLeases{}, &collectorTestControl{refreshes: refreshes}, []Provider{provider}); err != nil {
		t.Fatal(err)
	}
	startsMutex.Lock()
	defer startsMutex.Unlock()
	if starts != 2 {
		t.Fatalf("provider started %d times; want 2", starts)
	}
}
