package donations

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"
)

type liveListenerConnection struct {
	userID     int
	credential string
}

type runningLiveListener struct {
	cancel     context.CancelFunc
	credential string
}

type liveListenerCompletion struct {
	userID     int
	credential string
	err        error
}

type liveListenerSupervisor struct {
	displayName  string
	refreshEvery time.Duration
	connections  func(context.Context) ([]liveListenerConnection, error)
	listen       func(context.Context, liveListenerConnection) error
}

func (supervisor liveListenerSupervisor) Run(ctx context.Context) error {
	running := make(map[int]runningLiveListener)
	completed := make(chan liveListenerCompletion)
	var listeners sync.WaitGroup
	defer func() {
		for _, listener := range running {
			listener.cancel()
		}
		listeners.Wait()
	}()

	if err := supervisor.refresh(ctx, running, completed, &listeners); err != nil {
		return err
	}
	refreshTicker := time.NewTicker(supervisor.refreshEvery)
	defer refreshTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil
		case completion := <-completed:
			listener, exists := running[completion.userID]
			if exists && listener.credential == completion.credential {
				delete(running, completion.userID)
			}
			if completion.err != nil {
				slog.Error(supervisor.displayName+" listener exited", "userId", completion.userID, "error", completion.err)
			}
		case <-refreshTicker.C:
			if err := supervisor.refresh(ctx, running, completed, &listeners); err != nil {
				slog.Error("refresh "+supervisor.displayName+" listeners", "error", err)
			}
		}
	}
}

func (supervisor liveListenerSupervisor) refresh(ctx context.Context, running map[int]runningLiveListener, completed chan<- liveListenerCompletion, listeners *sync.WaitGroup) error {
	connections, err := supervisor.connections(ctx)
	if err != nil {
		return fmt.Errorf("get %s connections: %w", supervisor.displayName, err)
	}
	byUserID := make(map[int]liveListenerConnection, len(connections))
	for _, connection := range connections {
		byUserID[connection.userID] = connection
	}
	for userID, listener := range running {
		connection, exists := byUserID[userID]
		if !exists || connection.credential != listener.credential {
			listener.cancel()
			delete(running, userID)
		}
	}
	for _, connection := range connections {
		if _, exists := running[connection.userID]; exists {
			continue
		}
		listenerCtx, cancel := context.WithCancel(ctx)
		running[connection.userID] = runningLiveListener{cancel: cancel, credential: connection.credential}
		listeners.Add(1)
		go func(connection liveListenerConnection) {
			defer listeners.Done()
			err := supervisor.listen(listenerCtx, connection)
			select {
			case completed <- liveListenerCompletion{userID: connection.userID, credential: connection.credential, err: err}:
			case <-ctx.Done():
			}
		}(connection)
	}
	return nil
}
