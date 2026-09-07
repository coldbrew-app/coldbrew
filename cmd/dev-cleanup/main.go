package main

import (
	"errors"
	"log/slog"
	"os"

	"github.com/lebedev-nikita/coldbrew/internal/chat"
)

func main() {
	if err := run(); err != nil {
		slog.Error("NATS worktree cleanup failed", "error", err)
		os.Exit(1)
	}
}

func run() error {
	keepNamespace := os.Getenv("NATS_NAMESPACE")
	if keepNamespace == "" {
		return errors.New("NATS_NAMESPACE is required to preserve the primary worktree")
	}
	servers := os.Getenv("NATS_SERVERS")
	if servers == "" {
		servers = "nats://localhost:4222"
	}
	return chat.DeleteOtherWorktreeNatsNamespaces(servers, keepNamespace)
}
