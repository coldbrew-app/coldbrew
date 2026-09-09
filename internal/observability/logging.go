package observability

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/nats-io/nats.go"
)

const (
	streamBaseName = "OPERATIONAL_LOGS"
	queueCapacity  = 256
	maxEventAge    = 7 * 24 * time.Hour
	maxStreamBytes = 128 << 20
)

var streamNamePart = regexp.MustCompile(`[^A-Z0-9_-]`)

// Event is the wire format shared by log producers and notification consumers.
type Event struct {
	ID          string         `json:"id"`
	OccurredAt  time.Time      `json:"occurredAt"`
	Level       string         `json:"level"`
	Service     string         `json:"service"`
	Environment string         `json:"environment"`
	Message     string         `json:"message"`
	Fields      map[string]any `json:"fields,omitempty"`
}

// ConfigureDefault installs a structured stdout logger that also publishes log
// events to JetStream on a best-effort basis. NATS failures never stop or block
// the application. The returned function briefly drains queued events.
func ConfigureDefault(service string) func(context.Context) {
	stdout := slog.NewJSONHandler(os.Stdout, nil)
	publisher, err := newPublisher(service)
	if err != nil {
		fmt.Fprintf(os.Stderr, "operational log publisher unavailable: %v\n", err)
		slog.SetDefault(slog.New(stdout))
		return func(context.Context) {}
	}
	handler := &fanoutHandler{stdout: stdout, publisher: publisher}
	slog.SetDefault(slog.New(handler))
	return publisher.shutdown
}

type fanoutHandler struct {
	stdout    slog.Handler
	publisher *publisher
	fields    map[string]any
	groups    []string
}

func (handler *fanoutHandler) Enabled(ctx context.Context, level slog.Level) bool {
	return handler.stdout.Enabled(ctx, level)
}

func (handler *fanoutHandler) Handle(ctx context.Context, record slog.Record) error {
	err := handler.stdout.Handle(ctx, record)
	fields := cloneFields(handler.fields)
	record.Attrs(func(attr slog.Attr) bool {
		addAttr(fields, handler.groups, attr)
		return true
	})
	handler.publisher.publish(Event{
		ID:          newEventID(),
		OccurredAt:  record.Time,
		Level:       strings.ToLower(record.Level.String()),
		Service:     handler.publisher.service,
		Environment: environment(),
		Message:     record.Message,
		Fields:      fields,
	})
	return err
}

func (handler *fanoutHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	fields := cloneFields(handler.fields)
	for _, attr := range attrs {
		addAttr(fields, handler.groups, attr)
	}
	return &fanoutHandler{
		stdout:    handler.stdout.WithAttrs(attrs),
		publisher: handler.publisher,
		fields:    fields,
		groups:    append([]string(nil), handler.groups...),
	}
}

func (handler *fanoutHandler) WithGroup(name string) slog.Handler {
	if name == "" {
		return handler
	}
	return &fanoutHandler{
		stdout:    handler.stdout.WithGroup(name),
		publisher: handler.publisher,
		fields:    cloneFields(handler.fields),
		groups:    append(append([]string(nil), handler.groups...), name),
	}
}

func cloneFields(source map[string]any) map[string]any {
	result := make(map[string]any, len(source))
	for key, value := range source {
		if nested, ok := value.(map[string]any); ok {
			result[key] = cloneFields(nested)
		} else {
			result[key] = value
		}
	}
	return result
}

func addAttr(fields map[string]any, groups []string, attr slog.Attr) {
	attr.Value = attr.Value.Resolve()
	if attr.Equal(slog.Attr{}) {
		return
	}
	if attr.Value.Kind() == slog.KindGroup {
		for _, child := range attr.Value.Group() {
			addAttr(fields, append(groups, attr.Key), child)
		}
		return
	}
	if sensitiveKey(attr.Key) {
		target := fields
		for _, group := range groups {
			nested, ok := target[group].(map[string]any)
			if !ok {
				nested = make(map[string]any)
				target[group] = nested
			}
			target = nested
		}
		target[attr.Key] = "[REDACTED]"
		return
	}
	target := fields
	for _, group := range groups {
		nested, ok := target[group].(map[string]any)
		if !ok {
			nested = make(map[string]any)
			target[group] = nested
		}
		target = nested
	}
	if value, ok := attr.Value.Any().(error); ok {
		target[attr.Key] = value.Error()
		return
	}
	target[attr.Key] = attr.Value.Any()
}

func sensitiveKey(key string) bool {
	normalized := strings.ToLower(key)
	normalized = strings.NewReplacer("_", "", "-", "", ".", "").Replace(normalized)
	for _, part := range []string{"authorization", "cookie", "password", "secret", "token"} {
		if strings.Contains(normalized, part) {
			return true
		}
	}
	return false
}

type publisher struct {
	service    string
	connection *nats.Conn
	jetstream  nats.JetStreamContext
	subject    string
	queue      chan Event
	done       chan struct{}
	closing    atomic.Bool
	dropped    atomic.Uint64
	cancel     context.CancelFunc
	once       sync.Once
}

func newPublisher(service string) (*publisher, error) {
	servers := os.Getenv("NATS_SERVERS")
	if servers == "" {
		servers = nats.DefaultURL
	}
	connection, err := nats.Connect(servers, nats.Name(service+" operational logs"), nats.Timeout(2*time.Second))
	if err != nil {
		return nil, fmt.Errorf("connect NATS: %w", err)
	}
	jetstream, err := connection.JetStream(nats.PublishAsyncMaxPending(queueCapacity))
	if err != nil {
		connection.Close()
		return nil, fmt.Errorf("open JetStream: %w", err)
	}
	namespace := os.Getenv("NATS_NAMESPACE")
	if err := ensureStream(jetstream, namespace); err != nil {
		connection.Close()
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	publisher := &publisher{
		service: service, connection: connection, jetstream: jetstream,
		subject: logSubject(namespace, service), queue: make(chan Event, queueCapacity),
		done: make(chan struct{}), cancel: cancel,
	}
	go publisher.run(ctx)
	return publisher, nil
}

func (publisher *publisher) publish(event Event) {
	if publisher.closing.Load() {
		return
	}
	select {
	case publisher.queue <- event:
	default:
		dropped := publisher.dropped.Add(1)
		if dropped == 1 || dropped&(dropped-1) == 0 {
			fmt.Fprintf(os.Stderr, "operational log queue full; dropped %d events\n", dropped)
		}
	}
}

func (publisher *publisher) run(ctx context.Context) {
	defer close(publisher.done)
	for {
		select {
		case event := <-publisher.queue:
			publisher.send(event)
		case <-ctx.Done():
			for {
				select {
				case event := <-publisher.queue:
					publisher.send(event)
				default:
					return
				}
			}
		}
	}
}

func (publisher *publisher) send(event Event) {
	body, err := json.Marshal(event)
	if err != nil {
		fmt.Fprintf(os.Stderr, "encode operational log event: %v\n", err)
		return
	}
	for attempt := 0; attempt < 3; attempt++ {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		_, err = publisher.jetstream.Publish(publisher.subject, body, nats.MsgId(event.ID), nats.Context(ctx))
		cancel()
		if err == nil {
			return
		}
		time.Sleep(time.Duration(attempt+1) * 100 * time.Millisecond)
	}
	fmt.Fprintf(os.Stderr, "publish operational log event: %v\n", err)
}

func (publisher *publisher) shutdown(ctx context.Context) {
	publisher.once.Do(func() {
		publisher.closing.Store(true)
		publisher.cancel()
		select {
		case <-publisher.done:
		case <-ctx.Done():
		}
		publisher.connection.Close()
	})
}

func EnsureStream(jetstream nats.JetStreamContext, namespace string) error {
	return ensureStream(jetstream, namespace)
}

func ensureStream(jetstream nats.JetStreamContext, namespace string) error {
	name := logStreamName(namespace)
	if _, err := jetstream.StreamInfo(name); err == nil {
		return nil
	} else if !errors.Is(err, nats.ErrStreamNotFound) {
		return fmt.Errorf("inspect operational log stream: %w", err)
	}
	_, err := jetstream.AddStream(&nats.StreamConfig{
		Name: name, Subjects: []string{logSubject(namespace, ">")}, Storage: nats.FileStorage,
		Retention: nats.LimitsPolicy, Discard: nats.DiscardOld, MaxAge: maxEventAge,
		MaxBytes: maxStreamBytes, Duplicates: 2 * time.Minute,
	})
	if err != nil {
		if _, infoErr := jetstream.StreamInfo(name); infoErr == nil {
			return nil
		}
		return fmt.Errorf("create operational log stream: %w", err)
	}
	return nil
}

func LogSubject(namespace, service string) string { return logSubject(namespace, service) }

func LogStreamName(namespace string) string { return logStreamName(namespace) }

func logSubject(namespace, service string) string {
	prefix := "ops.logs"
	if namespace != "" {
		prefix = namespace + "." + prefix
	}
	return prefix + "." + service
}

func logStreamName(namespace string) string {
	if namespace == "" {
		return streamBaseName
	}
	part := streamNamePart.ReplaceAllString(strings.ToUpper(namespace), "_")
	return "CB_" + part + "_" + streamBaseName
}

func environment() string {
	if value := os.Getenv("APP_ENV"); value != "" {
		return value
	}
	if value := os.Getenv("NODE_ENV"); value != "" {
		return value
	}
	return "development"
}

func newEventID() string {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(value[:])
}
