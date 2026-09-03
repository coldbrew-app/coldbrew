package chat

import (
	"context"
	"errors"
	"time"
)

const (
	MaxConnections       = 20
	MaxSources           = 20
	MaxChatMessageLength = 500
	MaxTimeoutSeconds    = 1_209_600
)

var Providers = []string{"youtube", "twitch", "kick", "boosty", "vk_video"}

type Capability string

const (
	CapabilityRead          Capability = "read"
	CapabilitySendMessage   Capability = "send_message"
	CapabilityDeleteMessage Capability = "delete_message"
	CapabilityTimeoutUser   Capability = "timeout_user"
	CapabilityBanUser       Capability = "ban_user"
	CapabilityUnbanUser     Capability = "unban_user"
)

type Connection struct {
	ConnectionID   string       `json:"connectionId"`
	Provider       string       `json:"provider"`
	ProviderUserID string       `json:"providerUserId"`
	DisplayName    string       `json:"displayName"`
	Status         string       `json:"status"`
	Capabilities   []Capability `json:"capabilities"`
	ConnectedAt    time.Time    `json:"connectedAt"`
}

type Source struct {
	SourceID         string `json:"sourceId"`
	ConnectionID     string `json:"connectionId"`
	Provider         string `json:"provider"`
	ProviderSourceID string `json:"providerSourceId"`
	DisplayName      string `json:"displayName"`
	SourceURL        string `json:"sourceUrl"`
	Position         int    `json:"position"`
	Enabled          bool   `json:"enabled"`
}

type ProviderCredentials struct {
	AccessToken  string
	RefreshToken string
	ExpiresAt    *time.Time
	Scopes       []string
	TokenVersion int
}

type ConnectedSource struct {
	Source       Source
	Capabilities []Capability
	Credentials  ProviderCredentials
}

func (source ConnectedSource) HasCapability(capability Capability) bool {
	for _, current := range source.Capabilities {
		if current == capability {
			return true
		}
	}
	return false
}

type Config struct {
	Connections     []Connection `json:"connections"`
	Sources         []Source     `json:"sources"`
	HasOverlayToken bool         `json:"hasOverlayToken"`
}

type Author struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
}

type Message struct {
	ID           string    `json:"id"`
	SourceID     string    `json:"sourceId"`
	ConnectionID string    `json:"connectionId"`
	Provider     string    `json:"provider"`
	Author       Author    `json:"author"`
	Text         string    `json:"text"`
	OccurredAt   time.Time `json:"occurredAt"`
}

type StreamEvent struct {
	Type      string           `json:"type"`
	Message   *Message         `json:"message,omitempty"`
	SourceID  string           `json:"sourceId,omitempty"`
	MessageID string           `json:"messageId,omitempty"`
	State     string           `json:"state,omitempty"`
	Detail    string           `json:"detail,omitempty"`
	Error     *ConnectionError `json:"error,omitempty"`
}

type ConnectionError struct {
	Code   string `json:"code"`
	Detail string `json:"detail"`
}

type ModerationCommand struct {
	Type            string `json:"type"`
	SourceID        string `json:"sourceId"`
	MessageID       string `json:"messageId,omitempty"`
	ProviderUserID  string `json:"providerUserId,omitempty"`
	DurationSeconds int    `json:"durationSeconds,omitempty"`
	Reason          string `json:"reason,omitempty"`
}

func (command ModerationCommand) RequiredCapability() Capability {
	return Capability(command.Type)
}

func (command ModerationCommand) Validate() error {
	if !validUUID(command.SourceID) {
		return errors.New("chat source id is required")
	}
	switch command.Type {
	case "delete_message":
		if command.MessageID == "" || len([]rune(command.MessageID)) > 300 {
			return errors.New("invalid provider message id")
		}
	case "timeout_user":
		if command.ProviderUserID == "" || len([]rune(command.ProviderUserID)) > 200 || command.DurationSeconds <= 0 || command.DurationSeconds > MaxTimeoutSeconds || len([]rune(command.Reason)) > 500 {
			return errors.New("invalid timeout command")
		}
	case "ban_user":
		if command.ProviderUserID == "" || len([]rune(command.ProviderUserID)) > 200 || len([]rune(command.Reason)) > 500 {
			return errors.New("invalid ban command")
		}
	case "unban_user":
		if command.ProviderUserID == "" || len([]rune(command.ProviderUserID)) > 200 {
			return errors.New("invalid unban command")
		}
	default:
		return errors.New("invalid moderation command")
	}
	return nil
}

type CommandResult struct {
	SourceID string `json:"sourceId"`
	Status   string `json:"status"`
	Detail   string `json:"detail,omitempty"`
}

type BroadcastResult struct {
	Results []CommandResult `json:"results"`
}

type ProviderCommandSuccess struct {
	ProviderBanID string
}

type ProviderError struct {
	Type   string
	Detail string
	Cause  error
}

func (e *ProviderError) Error() string { return e.Detail }

type Provider interface {
	Name() string
	Collection() string
	Stream(context.Context, ConnectedSource) (<-chan StreamEvent, <-chan error)
	SendMessage(context.Context, ConnectedSource, string) error
	Moderate(context.Context, ConnectedSource, ModerationCommand, string) (ProviderCommandSuccess, error)
}

func MessageKey(message Message) string { return message.SourceID + ":" + message.ID }

func SourceKey(source Source) string { return source.SourceID }
