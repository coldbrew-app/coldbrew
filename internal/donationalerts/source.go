package donationalerts

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"
)

const defaultWebSocketURL = "wss://centrifugo.donationalerts.com/connection/websocket"

type Source struct {
	client         *Client
	webSocketURL   string
	retryStart     time.Duration
	retryMax       time.Duration
	pingInterval   time.Duration
	commandTimeout time.Duration
	wait           func(context.Context, time.Duration) error
}

func NewSource(client *Client) *Source {
	return &Source{
		client:         client,
		webSocketURL:   defaultWebSocketURL,
		retryStart:     5 * time.Second,
		retryMax:       60 * time.Second,
		pingInterval:   25 * time.Second,
		commandTimeout: 5 * time.Second,
		wait:           waitContext,
	}
}

// Run emits donations until the context is cancelled or credentials are unauthorized.
func (source *Source) Run(ctx context.Context, accessToken string, emit func(Donation) error) error {
	retryDelay := source.retryStart
	position := streamPosition{}
	for ctx.Err() == nil {
		profile, err := source.client.SocketProfile(ctx, accessToken)
		result := sessionResult{position: position}
		if err == nil {
			result, err = source.runSession(ctx, accessToken, profile, position, emit)
			position = result.position
			if result.subscribed || result.emitted {
				retryDelay = source.retryStart
			}
		}
		if ctx.Err() != nil {
			return nil
		}
		if isUnauthorized(err) {
			return err
		}
		if err != nil {
			if result.subscribed && isTransportError(err) {
				slog.DebugContext(ctx, "DonationAlerts websocket reconnecting", "error", err, "retry", retryDelay)
			} else {
				slog.WarnContext(ctx, "DonationAlerts listener will reconnect", "error", err, "retry", retryDelay)
			}
		}
		if err := source.wait(ctx, retryDelay); err != nil {
			return nil
		}
		retryDelay = min(retryDelay*2, source.retryMax)
	}
	return nil
}

type sessionResult struct {
	subscribed bool
	emitted    bool
	position   streamPosition
}

type invalidDonationError struct{ cause error }

func (err *invalidDonationError) Error() string { return err.cause.Error() }
func (err *invalidDonationError) Unwrap() error { return err.cause }

func (source *Source) runSession(
	ctx context.Context,
	accessToken string,
	profile SocketProfile,
	position streamPosition,
	emit func(Donation) error,
) (sessionResult, error) {
	channel := "$alerts:donation_" + profile.UserID
	session := socketSession{
		url:             source.webSocketURL,
		connectionToken: profile.SocketConnectionToken,
		channel:         channel,
		position:        position,
		pingInterval:    source.pingInterval,
		commandTimeout:  source.commandTimeout,
		refreshConnectionToken: func(ctx context.Context) (string, error) {
			refreshed, err := source.client.SocketProfile(ctx, accessToken)
			if err != nil {
				return "", fmt.Errorf("refresh DonationAlerts websocket token: %w", err)
			}
			if refreshed.UserID != profile.UserID {
				return "", fmt.Errorf("DonationAlerts socket profile changed user from %q to %q", profile.UserID, refreshed.UserID)
			}
			return refreshed.SocketConnectionToken, nil
		},
		refreshSubscriptionToken: func(ctx context.Context, socketClientID string) (string, error) {
			token, err := source.client.ChannelToken(ctx, accessToken, channel, socketClientID)
			if err != nil {
				return "", fmt.Errorf("authorize DonationAlerts channel %q for socket client %q: %w", channel, socketClientID, err)
			}
			return token, nil
		},
		onPublication: func(body []byte) error {
			var raw rawDonation
			if err := json.Unmarshal(body, &raw); err != nil {
				return &invalidDonationError{cause: fmt.Errorf("invalid DonationAlerts donation: %w", err)}
			}
			donation, err := raw.donation()
			if err != nil {
				return &invalidDonationError{cause: err}
			}
			return emit(donation)
		},
	}
	return session.run(ctx)
}

func isUnauthorized(err error) bool {
	var requestError *RequestError
	return errors.As(err, &requestError) && requestError.Unauthorized
}

func waitContext(ctx context.Context, duration time.Duration) error {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
