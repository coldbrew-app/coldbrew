package restream

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

var (
	ErrPublisherNotAuthorized = errors.New("publisher not authorized")
	ErrSessionNotFound        = errors.New("restream session not found")
)

type Destination struct {
	ID        string `json:"destinationId"`
	TargetURL string `json:"targetUrl"`
}

type Authorization struct {
	SessionID    string        `json:"sessionId"`
	Destinations []Destination `json:"destinations"`
}

type DestinationState struct {
	DestinationID string `json:"destinationId"`
	State         string `json:"state"`
	OutboundBytes uint64 `json:"outboundBytes"`
}

type ControlPlane interface {
	Authorize(context.Context, string, string, string) (Authorization, error)
	Heartbeat(context.Context, string, string, []DestinationState) error
	End(context.Context, string, string) error
}

type ControlClient struct {
	url        string
	secret     string
	httpClient *http.Client
}

func NewControlClient(url, secret string, httpClient *http.Client) *ControlClient {
	return &ControlClient{url: url, secret: secret, httpClient: httpClient}
}

func (client *ControlClient) Authorize(ctx context.Context, nodeID, publisherID, path string) (Authorization, error) {
	var result Authorization
	status, err := client.request(ctx, map[string]any{
		"type": "authorize", "nodeId": nodeID, "publisherId": publisherID, "path": path,
	}, &result)
	if err != nil {
		return Authorization{}, err
	}
	if status == http.StatusForbidden {
		return Authorization{}, ErrPublisherNotAuthorized
	}
	if status != http.StatusOK {
		return Authorization{}, fmt.Errorf("authorize publisher: control plane returned HTTP %d", status)
	}
	if result.SessionID == "" || len(result.Destinations) == 0 || len(result.Destinations) > 3 {
		return Authorization{}, errors.New("authorize publisher: invalid control plane response")
	}
	for _, destination := range result.Destinations {
		if destination.ID == "" || destination.TargetURL == "" {
			return Authorization{}, errors.New("authorize publisher: invalid destination")
		}
	}
	return result, nil
}

func (client *ControlClient) Heartbeat(ctx context.Context, nodeID, sessionID string, destinations []DestinationState) error {
	status, err := client.request(ctx, map[string]any{
		"type": "heartbeat", "nodeId": nodeID, "sessionId": sessionID, "destinations": destinations,
	}, nil)
	if err != nil {
		return err
	}
	if status == http.StatusNotFound {
		return ErrSessionNotFound
	}
	if status != http.StatusNoContent {
		return fmt.Errorf("send heartbeat: control plane returned HTTP %d", status)
	}
	return nil
}

func (client *ControlClient) End(ctx context.Context, nodeID, sessionID string) error {
	status, err := client.request(ctx, map[string]any{
		"type": "ended", "nodeId": nodeID, "sessionId": sessionID,
	}, nil)
	if err != nil {
		return err
	}
	if status == http.StatusNotFound {
		return ErrSessionNotFound
	}
	if status != http.StatusNoContent {
		return fmt.Errorf("end session: control plane returned HTTP %d", status)
	}
	return nil
}

func (client *ControlClient) request(ctx context.Context, input any, output any) (int, error) {
	body, err := json.Marshal(input)
	if err != nil {
		return 0, fmt.Errorf("encode control plane request: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, client.url, bytes.NewReader(body)) //nolint:gosec // The URL is operator-configured and validated at startup.
	if err != nil {
		return 0, fmt.Errorf("create control plane request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+client.secret)
	request.Header.Set("Content-Type", "application/json")
	response, err := client.httpClient.Do(request) //nolint:gosec // The URL is operator-configured and validated at startup.
	if err != nil {
		return 0, fmt.Errorf("request control plane: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	if output != nil && response.StatusCode >= 200 && response.StatusCode < 300 {
		decoder := json.NewDecoder(io.LimitReader(response.Body, 32*1024))
		if err := decoder.Decode(output); err != nil {
			return 0, fmt.Errorf("decode control plane response: %w", err)
		}
	}
	return response.StatusCode, nil
}

func DefaultHTTPClient() *http.Client {
	return &http.Client{Timeout: 10 * time.Second}
}
