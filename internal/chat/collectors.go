package chat

import (
	"context"
	"fmt"
	"log/slog"
	"time"
)

const (
	collectorReconcileInterval = 10 * time.Second
	collectorLeaseRetry        = 5 * time.Second
	collectorStreamRetry       = 2 * time.Second
)

type CollectorStore interface {
	GetAllEnabledSources(context.Context) ([]OwnedConnectedSource, error)
}

type CollectorLeases interface {
	Acquire(context.Context, string, string) (CollectorLease, error)
}

type CollectorRefreshControl interface {
	Refreshes(context.Context) (<-chan string, error)
}

type runningCollector struct {
	cancel       context.CancelFunc
	done         <-chan struct{}
	tokenVersion int
}

func RunCollectors(ctx context.Context, store CollectorStore, broker EventBroker, leases CollectorLeases, control CollectorRefreshControl, providers []Provider) error {
	providerByName := make(map[string]Provider, len(providers))
	for _, provider := range providers {
		providerByName[provider.Name()] = provider
	}
	refreshes, err := control.Refreshes(ctx)
	if err != nil {
		return err
	}
	serviceOwner := randomID()
	running := make(map[string]runningCollector)
	reconcile := func() error {
		sources, err := store.GetAllEnabledSources(ctx)
		if err != nil {
			return err
		}
		desired := make(map[string]OwnedConnectedSource)
		for _, source := range sources {
			provider := providerByName[source.ConnectedSource.Source.Provider]
			if provider != nil && provider.Collection() == "pull" {
				desired[source.ConnectedSource.Source.SourceID] = source
			}
		}
		for sourceID, collector := range running {
			source, exists := desired[sourceID]
			if exists && source.ConnectedSource.Credentials.TokenVersion == collector.tokenVersion {
				continue
			}
			collector.cancel()
			<-collector.done
			delete(running, sourceID)
		}
		for sourceID, source := range desired {
			if _, exists := running[sourceID]; exists {
				continue
			}
			collectorCtx, cancel := context.WithCancel(ctx)
			done := make(chan struct{})
			provider := providerByName[source.ConnectedSource.Source.Provider]
			go func() {
				defer close(done)
				collectSource(collectorCtx, source, provider, broker, leases, serviceOwner)
			}()
			running[sourceID] = runningCollector{cancel: cancel, done: done, tokenVersion: source.ConnectedSource.Credentials.TokenVersion}
		}
		return nil
	}
	if err := reconcile(); err != nil {
		return err
	}
	ticker := time.NewTicker(collectorReconcileInterval)
	defer ticker.Stop()
	defer func() {
		for _, collector := range running {
			collector.cancel()
		}
		for _, collector := range running {
			<-collector.done
		}
	}()
	for {
		select {
		case <-ctx.Done():
			return nil
		case sourceID, open := <-refreshes:
			if !open {
				refreshes = nil
				continue
			}
			if collector, exists := running[sourceID]; exists {
				collector.cancel()
				<-collector.done
				delete(running, sourceID)
			}
			if err := reconcile(); err != nil {
				slog.Error("Chat collector reconciliation failed", "error", err)
			}
		case <-ticker.C:
			if err := reconcile(); err != nil {
				slog.Error("Chat collector reconciliation failed", "error", err)
			}
		}
	}
}

func collectSource(ctx context.Context, owned OwnedConnectedSource, provider Provider, broker EventBroker, leases CollectorLeases, owner string) {
	sourceID := owned.ConnectedSource.Source.SourceID
	for ctx.Err() == nil {
		lease, err := leases.Acquire(ctx, sourceID, owner)
		if err != nil {
			slog.Error("Chat collector lease acquisition failed", "sourceId", sourceID, "error", err)
			if !waitFor(ctx, collectorLeaseRetry) {
				return
			}
			continue
		}
		if lease == nil {
			if !waitFor(ctx, collectorLeaseRetry) {
				return
			}
			continue
		}
		collectionCtx, cancel := context.WithCancel(ctx)
		maintained := make(chan error, 1)
		go func() { maintained <- lease.Maintain(collectionCtx) }()
		events, providerErrors := provider.Stream(collectionCtx, owned.ConnectedSource)
		collecting := true
		maintenanceFinished := false
		for collecting && collectionCtx.Err() == nil {
			select {
			case <-collectionCtx.Done():
				collecting = false
			case err := <-maintained:
				maintenanceFinished = true
				if err != nil {
					slog.Error("Chat collector lease lost", "sourceId", sourceID, "error", err)
				}
				collecting = false
			case event, open := <-events:
				if !open {
					events = nil
					if providerErrors == nil {
						collecting = false
					}
					continue
				}
				if err := broker.Publish(collectionCtx, owned.UserID, event, eventKey(event)); err != nil {
					slog.Error("publish chat event", "sourceId", sourceID, "error", err)
					collecting = false
				}
			case providerErr, open := <-providerErrors:
				if !open {
					providerErrors = nil
					if events == nil {
						collecting = false
					}
					continue
				}
				if providerErr != nil {
					event := StreamEvent{Type: "state", SourceID: sourceID, State: "error", Detail: providerErrorDetail(providerErr)}
					if err := broker.Publish(collectionCtx, owned.UserID, event, eventKey(event)); err != nil {
						slog.Error("publish chat provider error", "sourceId", sourceID, "error", err)
						collecting = false
					}
				}
			}
		}
		cancel()
		if !maintenanceFinished {
			<-maintained
		}
		if err := lease.Release(); err != nil && ctx.Err() == nil {
			slog.Error("Chat collector lease release failed", "sourceId", sourceID, "error", err)
		}
		if !waitFor(ctx, collectorStreamRetry) {
			return
		}
	}
}

func eventKey(event StreamEvent) string {
	if event.Type == "message" && event.Message != nil {
		return "message:" + event.Message.SourceID + ":" + event.Message.ID
	}
	if event.Type == "message_deleted" {
		return "deleted:" + event.SourceID + ":" + event.MessageID
	}
	source := event.SourceID
	if source == "" {
		source = "connection"
	}
	return fmt.Sprintf("%s:%s:%s", event.Type, source, randomID())
}

func waitFor(ctx context.Context, duration time.Duration) bool {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

var _ CollectorStore = (*Store)(nil)
var _ CollectorLeases = (*NatsCollectorLeases)(nil)
var _ CollectorRefreshControl = (*NatsCollectorControl)(nil)
