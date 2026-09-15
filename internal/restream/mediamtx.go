package restream

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
)

type ForwardStatus struct {
	Position      int
	State         string
	OutboundBytes uint64
}

type MediaServer interface {
	Configure(context.Context, string, []Destination) error
	ForwardStatuses(context.Context, string) ([]ForwardStatus, error)
	Delete(context.Context, string) error
}

type MediaMTXClient struct {
	baseURL    string
	httpClient *http.Client
}

func NewMediaMTXClient(baseURL string, httpClient *http.Client) *MediaMTXClient {
	return &MediaMTXClient{baseURL: baseURL, httpClient: httpClient}
}

func (client *MediaMTXClient) Configure(ctx context.Context, path string, destinations []Destination) error {
	forward := make([]map[string]string, 0, len(destinations))
	for _, destination := range destinations {
		forward = append(forward, map[string]string{"dest": destination.TargetURL})
	}
	payload := map[string]any{
		"source": "publisher", "overridePublisher": false, "forward": forward,
	}
	status, err := client.request(ctx, http.MethodPatch, "/v3/config/paths/patch/"+url.PathEscape(path), payload, nil)
	if err != nil {
		return err
	}
	if status == http.StatusNotFound {
		status, err = client.request(ctx, http.MethodPost, "/v3/config/paths/add/"+url.PathEscape(path), payload, nil)
		if err != nil {
			return err
		}
	}
	if status < 200 || status >= 300 {
		return fmt.Errorf("configure MediaMTX path: HTTP %d", status)
	}
	return nil
}

func (client *MediaMTXClient) ForwardStatuses(ctx context.Context, path string) ([]ForwardStatus, error) {
	var response struct {
		Items []struct {
			Position      int    `json:"pos"`
			State         string `json:"state"`
			OutboundBytes uint64 `json:"outboundBytes"`
		} `json:"items"`
	}
	status, err := client.request(ctx, http.MethodGet, "/v3/paths/forward-dests/list?path="+url.QueryEscape(path), nil, &response)
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		return nil, fmt.Errorf("list MediaMTX forward destinations: HTTP %d", status)
	}
	result := make([]ForwardStatus, 0, len(response.Items))
	for _, item := range response.Items {
		result = append(result, ForwardStatus{
			Position: item.Position - 1, State: item.State, OutboundBytes: item.OutboundBytes,
		})
	}
	return result, nil
}

func (client *MediaMTXClient) Delete(ctx context.Context, path string) error {
	status, err := client.request(ctx, http.MethodDelete, "/v3/config/paths/delete/"+url.PathEscape(path), nil, nil)
	if err != nil {
		return err
	}
	if status != http.StatusOK && status != http.StatusNoContent && status != http.StatusNotFound {
		return fmt.Errorf("delete MediaMTX path: HTTP %d", status)
	}
	return nil
}

func (client *MediaMTXClient) request(ctx context.Context, method, path string, input any, output any) (int, error) {
	var body io.Reader
	if input != nil {
		encoded, err := json.Marshal(input)
		if err != nil {
			return 0, fmt.Errorf("encode MediaMTX request: %w", err)
		}
		body = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, client.baseURL+path, body) //nolint:gosec // The base URL is restricted to loopback at startup.
	if err != nil {
		return 0, fmt.Errorf("create MediaMTX request: %w", err)
	}
	if input != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := client.httpClient.Do(request) //nolint:gosec // The base URL is restricted to loopback at startup.
	if err != nil {
		return 0, fmt.Errorf("request MediaMTX: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	if output != nil && response.StatusCode >= 200 && response.StatusCode < 300 {
		if err := json.NewDecoder(io.LimitReader(response.Body, 64*1024)).Decode(output); err != nil {
			return 0, fmt.Errorf("decode MediaMTX response: %w", err)
		}
	}
	return response.StatusCode, nil
}
