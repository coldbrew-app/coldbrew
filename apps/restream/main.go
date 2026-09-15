package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"regexp"
	"strings"
	"syscall"
	"time"

	"github.com/streambrew-app/streambrew/internal/restream"
)

var nodeIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,63}$`)

type config struct {
	nodeID            string
	controlURL        string
	sharedSecret      string
	controllerAddress string
	mediaAPIURL       string
	mediaBinary       string
	mediaConfig       string
}

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	if len(os.Args) > 1 && os.Args[1] == "hook" {
		if err := runHook(); err != nil {
			slog.Error("Restream hook failed", "error", err)
			os.Exit(1)
		}
		return
	}
	if len(os.Args) > 1 && os.Args[1] == "health" {
		if err := checkHealth(); err != nil {
			os.Exit(1)
		}
		return
	}
	if err := run(); err != nil {
		slog.Error("Restream media service stopped", "error", err)
		os.Exit(1)
	}
}

func run() error {
	settings, err := loadConfig()
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	httpClient := restream.DefaultHTTPClient()
	control := restream.NewControlClient(settings.controlURL, settings.sharedSecret, httpClient)
	media := restream.NewMediaMTXClient(settings.mediaAPIURL, httpClient)
	handler := restream.NewHTTPHandler(control, media, settings.nodeID)
	server := &http.Server{
		Addr: settings.controllerAddress, Handler: handler.Handler(), ReadHeaderTimeout: 5 * time.Second,
	}
	listener, err := net.Listen("tcp", settings.controllerAddress)
	if err != nil {
		return fmt.Errorf("listen for MediaMTX callbacks: %w", err)
	}
	serverErrors := make(chan error, 1)
	go func() { serverErrors <- server.Serve(listener) }()

	command := exec.CommandContext(ctx, settings.mediaBinary, settings.mediaConfig) //nolint:gosec // Both paths are trusted operator configuration.
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	command.Cancel = func() error { return command.Process.Signal(syscall.SIGTERM) }
	command.WaitDelay = 10 * time.Second
	if err := command.Start(); err != nil {
		_ = server.Close()
		return fmt.Errorf("start MediaMTX: %w", err)
	}
	mediaErrors := make(chan error, 1)
	go func() {
		mediaErrors <- command.Wait()
		close(mediaErrors)
	}()
	slog.Info("Restream media service started", "nodeId", settings.nodeID)

	var runErr error
	select {
	case <-ctx.Done():
	case err := <-serverErrors:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			runErr = fmt.Errorf("serve restream callbacks: %w", err)
		}
		stop()
	case err := <-mediaErrors:
		if err != nil && ctx.Err() == nil {
			runErr = fmt.Errorf("run MediaMTX: %w", err)
		}
		stop()
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil && runErr == nil {
		runErr = fmt.Errorf("shutdown restream callback server: %w", err)
	}
	select {
	case <-mediaErrors:
	case <-shutdownCtx.Done():
		if command.Process != nil {
			_ = command.Process.Kill()
		}
	}
	return runErr
}

func runHook() error {
	if len(os.Args) != 3 || (os.Args[2] != "online" && os.Args[2] != "offline") {
		return errors.New("hook requires online or offline")
	}
	path := os.Getenv("MTX_PATH")
	if path == "" {
		return errors.New("MTX_PATH is required")
	}
	address := os.Getenv("RESTREAM_CONTROLLER_ADDR")
	if address == "" {
		address = "127.0.0.1:9998"
	}
	if err := validateLoopbackAddress(address); err != nil {
		return fmt.Errorf("RESTREAM_CONTROLLER_ADDR: %w", err)
	}
	body, err := json.Marshal(map[string]string{"path": path})
	if err != nil {
		return err
	}
	request, err := http.NewRequest(http.MethodPost, "http://"+address+"/v1/hooks/"+os.Args[2], bytes.NewReader(body)) //nolint:gosec // The address is restricted to loopback above.
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := restream.DefaultHTTPClient().Do(request) //nolint:gosec // The address is restricted to loopback above.
	if err != nil {
		return fmt.Errorf("call restream hook: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusNoContent {
		return fmt.Errorf("call restream hook: HTTP %d", response.StatusCode)
	}
	return nil
}

func checkHealth() error {
	address := os.Getenv("RESTREAM_CONTROLLER_ADDR")
	if address == "" {
		address = "127.0.0.1:9998"
	}
	if err := validateLoopbackAddress(address); err != nil {
		return fmt.Errorf("RESTREAM_CONTROLLER_ADDR: %w", err)
	}
	request, err := http.NewRequest(http.MethodGet, "http://"+address+"/health", nil) //nolint:gosec // The address is restricted to loopback above.
	if err != nil {
		return err
	}
	response, err := restream.DefaultHTTPClient().Do(request) //nolint:gosec // The address is restricted to loopback above.
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusNoContent {
		return fmt.Errorf("health check: HTTP %d", response.StatusCode)
	}
	return nil
}

func loadConfig() (config, error) {
	result := config{
		nodeID:            strings.TrimSpace(os.Getenv("RESTREAM_NODE_ID")),
		controlURL:        strings.TrimSpace(os.Getenv("RESTREAM_CONTROL_URL")),
		sharedSecret:      os.Getenv("RESTREAM_MEDIA_SHARED_SECRET"),
		controllerAddress: strings.TrimSpace(os.Getenv("RESTREAM_CONTROLLER_ADDR")),
		mediaAPIURL:       strings.TrimSpace(os.Getenv("MEDIAMTX_API_URL")),
		mediaBinary:       strings.TrimSpace(os.Getenv("MEDIAMTX_BINARY")),
		mediaConfig:       strings.TrimSpace(os.Getenv("MEDIAMTX_CONFIG")),
	}
	if !nodeIDPattern.MatchString(result.nodeID) {
		return config{}, errors.New("RESTREAM_NODE_ID must be a lowercase node identifier")
	}
	if err := validateControlURL(result.controlURL); err != nil {
		return config{}, err
	}
	if len(result.sharedSecret) < 32 {
		return config{}, errors.New("RESTREAM_MEDIA_SHARED_SECRET must contain at least 32 characters")
	}
	if result.controllerAddress == "" {
		result.controllerAddress = "127.0.0.1:9998"
	}
	if err := validateLoopbackAddress(result.controllerAddress); err != nil {
		return config{}, fmt.Errorf("RESTREAM_CONTROLLER_ADDR: %w", err)
	}
	if result.mediaAPIURL == "" {
		result.mediaAPIURL = "http://127.0.0.1:9997"
	}
	if err := validateMediaAPIURL(result.mediaAPIURL); err != nil {
		return config{}, err
	}
	if result.mediaBinary == "" {
		result.mediaBinary = "/mediamtx"
	}
	if result.mediaConfig == "" {
		result.mediaConfig = "/etc/mediamtx.yml"
	}
	return result, nil
}

func validateControlURL(value string) error {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" || parsed.Path != "/api/restream/media" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return errors.New("RESTREAM_CONTROL_URL must point to /api/restream/media")
	}
	if parsed.Scheme != "https" && (parsed.Scheme != "http" || !isLoopbackHost(parsed.Hostname())) {
		return errors.New("RESTREAM_CONTROL_URL must use HTTPS")
	}
	return nil
}

func validateMediaAPIURL(value string) error {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "http" || parsed.Host == "" || parsed.Path != "" || !isLoopbackHost(parsed.Hostname()) {
		return errors.New("MEDIAMTX_API_URL must be an HTTP loopback URL without a path")
	}
	return nil
}

func validateLoopbackAddress(value string) error {
	host, port, err := net.SplitHostPort(value)
	if err != nil || !isLoopbackHost(host) || port == "" {
		return errors.New("must be a loopback host and port")
	}
	return nil
}

func isLoopbackHost(host string) bool {
	return host == "localhost" || net.ParseIP(host) != nil && net.ParseIP(host).IsLoopback()
}
