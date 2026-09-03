package chat

import (
	"context"
	"fmt"
	"strings"
	"sync"
)

type AuditEntry struct {
	UserID            int
	SourceID          string
	Provider          string
	ActionType        string
	Status            string
	ProviderMessageID string
	ProviderUserID    string
	DurationSeconds   int
	Reason            string
	Detail            string
}

type Repository interface {
	GetConfig(context.Context, int) (Config, error)
	GetEnabledSources(context.Context, int) ([]ConnectedSource, error)
	GetSource(context.Context, int, string) (*ConnectedSource, error)
	GetProviderBanID(context.Context, string, string) (string, error)
	SaveProviderBanID(context.Context, string, string, string) error
	DeleteProviderBanID(context.Context, string, string) error
	RecordAction(context.Context, AuditEntry) error
}

type EventBroker interface {
	Publish(context.Context, int, StreamEvent, string) error
	Stream(context.Context, int) <-chan StreamEvent
}

type CollectorControl interface {
	RequestRefresh(context.Context, string) error
}

type ApplicationError struct {
	Type   string
	Detail string
}

func (e *ApplicationError) Error() string { return e.Detail }

type Application struct {
	repository       Repository
	broker           EventBroker
	providers        map[string]Provider
	collectorControl CollectorControl
}

func NewApplication(repository Repository, broker EventBroker, providers []Provider, collectorControl CollectorControl) *Application {
	providerMap := make(map[string]Provider, len(providers))
	for _, provider := range providers {
		providerMap[provider.Name()] = provider
	}
	return &Application{repository: repository, broker: broker, providers: providerMap, collectorControl: collectorControl}
}

func (application *Application) Config(ctx context.Context, userID int) (Config, error) {
	return application.repository.GetConfig(ctx, userID)
}

func (application *Application) Stream(ctx context.Context, userID int) <-chan StreamEvent {
	return application.broker.Stream(ctx, userID)
}

func (application *Application) RefreshSource(ctx context.Context, userID int, sourceID string) error {
	source, err := application.repository.GetSource(ctx, userID, sourceID)
	if err != nil {
		return err
	}
	if source == nil {
		return &ApplicationError{Type: "chat source not found", Detail: "Chat source not found"}
	}
	if source.Source.Provider != "youtube" {
		return &ApplicationError{Type: "chat source refresh unsupported", Detail: "Manual stream discovery is only available for YouTube"}
	}
	return application.collectorControl.RequestRefresh(ctx, sourceID)
}

func (application *Application) Broadcast(ctx context.Context, userID int, text string) (BroadcastResult, error) {
	normalized := strings.TrimSpace(text)
	if len([]rune(normalized)) == 0 || len([]rune(normalized)) > MaxChatMessageLength {
		return BroadcastResult{}, &ApplicationError{Type: "invalid chat message", Detail: fmt.Sprintf("A chat message must contain between 1 and %d characters", MaxChatMessageLength)}
	}
	sources, err := application.repository.GetEnabledSources(ctx, userID)
	if err != nil {
		return BroadcastResult{}, err
	}
	results := make([]CommandResult, len(sources))
	errorsByIndex := make([]error, len(sources))
	var waitGroup sync.WaitGroup
	for index, connectedSource := range sources {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			source := connectedSource.Source
			provider, exists := application.providers[source.Provider]
			result := CommandResult{SourceID: source.SourceID}
			if !exists || !connectedSource.HasCapability(CapabilitySendMessage) {
				result.Status = "unsupported"
				result.Detail = "This provider connection is read-only"
			} else if err := provider.SendMessage(ctx, connectedSource, normalized); err != nil {
				result.Status = "failed"
				result.Detail = providerErrorDetail(err)
			} else {
				result.Status = "succeeded"
			}
			results[index] = result
			errorsByIndex[index] = application.repository.RecordAction(ctx, AuditEntry{UserID: userID, SourceID: source.SourceID, Provider: source.Provider, ActionType: "send_message", Status: result.Status, Detail: result.Detail})
		}()
	}
	waitGroup.Wait()
	for _, err := range errorsByIndex {
		if err != nil {
			return BroadcastResult{}, err
		}
	}
	return BroadcastResult{Results: results}, nil
}

func (application *Application) Moderate(ctx context.Context, userID int, command ModerationCommand) (CommandResult, error) {
	command.Reason = strings.TrimSpace(command.Reason)
	if err := command.Validate(); err != nil {
		return CommandResult{}, &ApplicationError{Type: "invalid chat command", Detail: err.Error()}
	}
	connectedSource, err := application.repository.GetSource(ctx, userID, command.SourceID)
	if err != nil {
		return CommandResult{}, err
	}
	if connectedSource == nil {
		return CommandResult{}, &ApplicationError{Type: "chat source not found", Detail: "Chat source not found"}
	}
	provider, exists := application.providers[connectedSource.Source.Provider]
	if !exists || !connectedSource.HasCapability(command.RequiredCapability()) {
		return CommandResult{}, &ApplicationError{Type: "chat command unsupported", Detail: "This action is not available for the provider connection"}
	}
	providerBanID := ""
	if command.Type == "unban_user" {
		providerBanID, err = application.repository.GetProviderBanID(ctx, command.SourceID, command.ProviderUserID)
		if err != nil {
			return CommandResult{}, err
		}
	}
	success, providerErr := provider.Moderate(ctx, *connectedSource, command, providerBanID)
	result := CommandResult{SourceID: command.SourceID, Status: "succeeded"}
	if providerErr != nil {
		result.Status = "failed"
		result.Detail = providerErrorDetail(providerErr)
	}
	audit := AuditEntry{UserID: userID, SourceID: command.SourceID, Provider: connectedSource.Source.Provider, ActionType: command.Type, Status: result.Status, ProviderUserID: command.ProviderUserID, DurationSeconds: command.DurationSeconds, Reason: command.Reason, Detail: result.Detail}
	if command.Type == "delete_message" {
		audit.ProviderMessageID = command.MessageID
		audit.ProviderUserID = ""
	}
	if err := application.repository.RecordAction(ctx, audit); err != nil {
		return CommandResult{}, err
	}
	if providerErr != nil {
		return result, nil
	}
	if success.ProviderBanID != "" && command.Type != "delete_message" {
		if err := application.repository.SaveProviderBanID(ctx, command.SourceID, command.ProviderUserID, success.ProviderBanID); err != nil {
			return CommandResult{}, err
		}
	}
	if command.Type == "unban_user" {
		if err := application.repository.DeleteProviderBanID(ctx, command.SourceID, command.ProviderUserID); err != nil {
			return CommandResult{}, err
		}
	}
	if command.Type == "delete_message" {
		event := StreamEvent{Type: "message_deleted", SourceID: command.SourceID, MessageID: command.MessageID}
		if err := application.broker.Publish(ctx, userID, event, "moderation-delete:"+command.SourceID+":"+command.MessageID); err != nil {
			return CommandResult{}, err
		}
	}
	return result, nil
}

func providerErrorDetail(err error) string {
	if providerError, ok := err.(*ProviderError); ok {
		return providerError.Detail
	}
	return err.Error()
}
