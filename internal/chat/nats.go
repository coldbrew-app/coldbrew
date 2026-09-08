package chat

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/nats-io/nats.go"
)

const (
	chatStream                        = "CHAT_EVENTS"
	chatSubjectPrefix                 = "chat.user"
	collectorLeaseBucket              = "chat_collectors"
	chatStateBucket                   = "chat_source_states"
	collectorRefreshBucket            = "chat_collector_refreshes"
	chatDeadLetterStream              = "CHAT_DEAD_LETTERS"
	chatDeadLetterSubject             = "chat.dead_letter"
	chatEventMaxAge                   = 15 * time.Minute
	chatEventMaxPerUser         int64 = 2500
	chatDuplicateWindow               = 2 * time.Minute
	chatDeadLetterMaxAge              = 30 * 24 * time.Hour
	chatDeadLetterMaxMessages         = 10_000
	chatDeadLetterMaxBytes            = 64 << 20
	chatDeadLetterPayloadLimit        = 64 << 10
	chatDeadLetterMaxDeliveries       = 3
	chatDeadLetterRetryDelay          = 250 * time.Millisecond
	collectorLeaseTTL                 = 30 * time.Second
	collectorLeaseHeartbeat           = 10 * time.Second
)

var (
	natsNamespacePattern         = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,47}$`)
	worktreeNatsNamespacePattern = regexp.MustCompile(`^wt_[0-9a-f]{8}$`)
	worktreeNatsStreamPattern    = regexp.MustCompile(`^(WT_[0-9A-F]{8})_CHAT_(EVENTS|DEAD_LETTERS)$`)
	worktreeNatsKeyValuePattern  = regexp.MustCompile(`^(wt_[0-9a-f]{8})_chat_(collectors|source_states|collector_refreshes)$`)
)

type natsResources struct {
	stream                 string
	subjectPrefix          string
	deadLetterStream       string
	deadLetterSubject      string
	collectorLeaseBucket   string
	chatStateBucket        string
	collectorRefreshBucket string
}

func resourcesForNamespace(namespace string) (natsResources, error) {
	if namespace == "" {
		return natsResources{
			stream:                 chatStream,
			subjectPrefix:          chatSubjectPrefix,
			deadLetterStream:       chatDeadLetterStream,
			deadLetterSubject:      chatDeadLetterSubject,
			collectorLeaseBucket:   collectorLeaseBucket,
			chatStateBucket:        chatStateBucket,
			collectorRefreshBucket: collectorRefreshBucket,
		}, nil
	}
	if !natsNamespacePattern.MatchString(namespace) {
		return natsResources{}, errors.New("NATS namespace must match [a-z0-9][a-z0-9_-]{0,47}")
	}
	return natsResources{
		stream:                 strings.ToUpper(namespace) + "_" + chatStream,
		subjectPrefix:          namespace + "." + chatSubjectPrefix,
		deadLetterStream:       strings.ToUpper(namespace) + "_" + chatDeadLetterStream,
		deadLetterSubject:      namespace + "." + chatDeadLetterSubject,
		collectorLeaseBucket:   namespace + "_" + collectorLeaseBucket,
		chatStateBucket:        namespace + "_" + chatStateBucket,
		collectorRefreshBucket: namespace + "_" + collectorRefreshBucket,
	}, nil
}

type NatsConnection struct {
	connection       *nats.Conn
	Broker           *NatsEventBroker
	Leases           *NatsCollectorLeases
	CollectorControl *NatsCollectorControl
	DeadLetters      *NatsDeadLetterStore
}

func ConnectNats(servers, namespace string) (*NatsConnection, error) {
	resources, err := resourcesForNamespace(namespace)
	if err != nil {
		return nil, err
	}
	parts := strings.Split(servers, ",")
	for index := range parts {
		parts[index] = strings.TrimSpace(parts[index])
	}
	connection, err := nats.Connect(strings.Join(parts, ","))
	if err != nil {
		return nil, err
	}
	jetstream, err := connection.JetStream()
	if err != nil {
		connection.Close()
		return nil, err
	}
	if _, err := jetstream.StreamInfo(resources.stream); errors.Is(err, nats.ErrStreamNotFound) {
		_, err = jetstream.AddStream(&nats.StreamConfig{Name: resources.stream, Subjects: []string{resources.subjectPrefix + ".*"}, Storage: nats.MemoryStorage, Retention: nats.LimitsPolicy, Discard: nats.DiscardOld, MaxAge: chatEventMaxAge, MaxMsgsPerSubject: chatEventMaxPerUser, Duplicates: chatDuplicateWindow})
		if err != nil {
			connection.Close()
			return nil, err
		}
	} else if err != nil {
		connection.Close()
		return nil, err
	}
	if _, err := jetstream.StreamInfo(resources.deadLetterStream); errors.Is(err, nats.ErrStreamNotFound) {
		_, err = jetstream.AddStream(&nats.StreamConfig{Name: resources.deadLetterStream, Subjects: []string{resources.deadLetterSubject}, Storage: nats.FileStorage, Retention: nats.LimitsPolicy, Discard: nats.DiscardOld, MaxAge: chatDeadLetterMaxAge, MaxMsgs: chatDeadLetterMaxMessages, MaxBytes: chatDeadLetterMaxBytes, Duplicates: chatDuplicateWindow})
		if err != nil {
			connection.Close()
			return nil, err
		}
	} else if err != nil {
		connection.Close()
		return nil, err
	}
	leases, err := ensureKeyValue(jetstream, nats.KeyValueConfig{Bucket: resources.collectorLeaseBucket, TTL: collectorLeaseTTL, History: 1, Storage: nats.MemoryStorage})
	if err != nil {
		connection.Close()
		return nil, err
	}
	states, err := ensureKeyValue(jetstream, nats.KeyValueConfig{Bucket: resources.chatStateBucket, TTL: chatEventMaxAge, History: 1, Storage: nats.MemoryStorage})
	if err != nil {
		connection.Close()
		return nil, err
	}
	refreshes, err := ensureKeyValue(jetstream, nats.KeyValueConfig{Bucket: resources.collectorRefreshBucket, TTL: chatEventMaxAge, History: 1, Storage: nats.MemoryStorage})
	if err != nil {
		connection.Close()
		return nil, err
	}
	deadLetters := &NatsDeadLetterStore{jetstream: jetstream, stream: resources.deadLetterStream, subject: resources.deadLetterSubject}
	return &NatsConnection{connection: connection, Broker: &NatsEventBroker{jetstream: jetstream, states: states, subjectPrefix: resources.subjectPrefix, stateBucket: resources.chatStateBucket, deadLetters: deadLetters}, Leases: &NatsCollectorLeases{bucket: leases}, CollectorControl: &NatsCollectorControl{bucket: refreshes}, DeadLetters: deadLetters}, nil
}

func DeleteNatsNamespace(servers, namespace string) error {
	if namespace == "" {
		return errors.New("refusing to delete the unnamespaced NATS resources")
	}
	if _, err := resourcesForNamespace(namespace); err != nil {
		return err
	}
	connection, err := nats.Connect(servers)
	if err != nil {
		return err
	}
	defer connection.Close()
	jetstream, err := connection.JetStream()
	if err != nil {
		return err
	}
	return deleteNatsNamespace(jetstream, namespace)
}

func DeleteOtherWorktreeNatsNamespaces(servers, keepNamespace string) error {
	if !worktreeNatsNamespacePattern.MatchString(keepNamespace) {
		return errors.New("NATS_NAMESPACE must identify the primary worktree")
	}
	connection, err := nats.Connect(servers)
	if err != nil {
		return err
	}
	defer connection.Close()
	jetstream, err := connection.JetStream()
	if err != nil {
		return err
	}
	streamNames := make([]string, 0)
	for name := range jetstream.StreamNames() {
		streamNames = append(streamNames, name)
	}
	bucketNames := make([]string, 0)
	for name := range jetstream.KeyValueStoreNames() {
		bucketNames = append(bucketNames, name)
	}
	for _, namespace := range worktreeNamespacesFromResources(streamNames, bucketNames) {
		if namespace == keepNamespace {
			continue
		}
		if err := deleteNatsNamespace(jetstream, namespace); err != nil {
			return err
		}
	}
	return nil
}

func worktreeNamespacesFromResources(streamNames, bucketNames []string) []string {
	namespaces := make(map[string]struct{})
	for _, name := range streamNames {
		if matches := worktreeNatsStreamPattern.FindStringSubmatch(name); matches != nil {
			namespaces[strings.ToLower(matches[1])] = struct{}{}
		}
	}
	for _, name := range bucketNames {
		if matches := worktreeNatsKeyValuePattern.FindStringSubmatch(name); matches != nil {
			namespaces[matches[1]] = struct{}{}
		}
	}
	result := make([]string, 0, len(namespaces))
	for namespace := range namespaces {
		result = append(result, namespace)
	}
	slices.Sort(result)
	return result
}

func deleteNatsNamespace(jetstream nats.JetStreamContext, namespace string) error {
	resources, err := resourcesForNamespace(namespace)
	if err != nil {
		return err
	}
	for _, bucket := range []string{resources.collectorLeaseBucket, resources.chatStateBucket, resources.collectorRefreshBucket} {
		if err := jetstream.DeleteKeyValue(bucket); err != nil && !errors.Is(err, nats.ErrBucketNotFound) && !errors.Is(err, nats.ErrStreamNotFound) {
			return err
		}
	}
	for _, stream := range []string{resources.stream, resources.deadLetterStream} {
		if err := jetstream.DeleteStream(stream); err != nil && !errors.Is(err, nats.ErrStreamNotFound) {
			return err
		}
	}
	return nil
}

func (connection *NatsConnection) Close() error {
	return connection.connection.Drain()
}

func ensureKeyValue(jetstream nats.JetStreamContext, config nats.KeyValueConfig) (nats.KeyValue, error) {
	bucket, err := jetstream.KeyValue(config.Bucket)
	if err == nil {
		return bucket, nil
	}
	if !errors.Is(err, nats.ErrBucketNotFound) {
		return nil, err
	}
	return jetstream.CreateKeyValue(&config)
}

type NatsEventBroker struct {
	jetstream     nats.JetStreamContext
	states        nats.KeyValue
	subjectPrefix string
	stateBucket   string
	deadLetters   *NatsDeadLetterStore
}

func (broker *NatsEventBroker) Publish(_ context.Context, userID int, event StreamEvent, idempotencyKey string) error {
	body, err := json.Marshal(event)
	if err != nil {
		return err
	}
	if _, err := broker.jetstream.Publish(broker.userSubject(userID), body, nats.MsgId(idempotencyKey)); err != nil {
		return err
	}
	var stateEvent *StreamEvent
	if event.Type == "state" {
		stateEvent = &event
	} else if event.Type == "message" && event.Message != nil {
		stateEvent = &StreamEvent{Type: "state", SourceID: event.Message.SourceID, State: "live"}
	}
	if stateEvent != nil {
		body, err := json.Marshal(stateEvent)
		if err != nil {
			return err
		}
		_, err = broker.states.Put(sourceStateKey(userID, stateEvent.SourceID), body)
		return err
	}
	return nil
}

func (broker *NatsEventBroker) Stream(ctx context.Context, userID int) <-chan StreamEvent {
	output := make(chan StreamEvent)
	messages := make(chan *nats.Msg, 128)
	subscription, err := broker.jetstream.ChanSubscribe(
		broker.userSubject(userID),
		messages,
		nats.DeliverNew(),
		nats.AckExplicit(),
		nats.ManualAck(),
	)
	if err != nil {
		close(output)
		return output
	}
	go func() {
		defer close(output)
		defer subscription.Unsubscribe()
		keys, err := broker.states.Keys()
		if err != nil && !errors.Is(err, nats.ErrNoKeysFound) {
			return
		}
		prefix := fmt.Sprintf("%d.", userID)
		for _, key := range keys {
			if !strings.HasPrefix(key, prefix) {
				continue
			}
			entry, err := broker.states.Get(key)
			if err != nil {
				continue
			}
			event, decodeErr := decodeStreamEvent(entry.Value())
			if decodeErr != nil {
				broker.storeDeadLetter(ctx, "kv://"+broker.stateBucket+"/"+key, entry.Value(), decodeErr)
				continue
			}
			if !sendEvent(ctx, output, event) {
				return
			}
		}
		for {
			select {
			case <-ctx.Done():
				return
			case message, open := <-messages:
				if !open {
					return
				}
				event, decodeErr := decodeStreamEvent(message.Data)
				if decodeErr != nil {
					broker.handlePoisonMessage(ctx, message, decodeErr)
					continue
				}
				if !sendEvent(ctx, output, event) {
					return
				}
				if err := message.Ack(); err != nil {
					slog.Warn("Failed to acknowledge NATS chat event", "subject", message.Subject, "error", err)
				}
			}
		}
	}()
	return output
}

func sendEvent(ctx context.Context, output chan<- StreamEvent, event StreamEvent) bool {
	select {
	case <-ctx.Done():
		return false
	case output <- event:
		return true
	}
}

func (broker *NatsEventBroker) handlePoisonMessage(ctx context.Context, message *nats.Msg, failure error) {
	metadata, err := message.Metadata()
	if err == nil && metadata.NumDelivered < chatDeadLetterMaxDeliveries {
		if err := message.NakWithDelay(chatDeadLetterRetryDelay); err != nil {
			slog.Warn("Failed to retry invalid NATS chat event", "subject", message.Subject, "error", err)
		}
		return
	}
	if broker.storeDeadLetter(ctx, message.Subject, message.Data, failure) {
		if err := message.Term(); err != nil {
			slog.Warn("Failed to terminate invalid NATS chat event", "subject", message.Subject, "error", err)
		}
		return
	}
	if err := message.NakWithDelay(chatDeadLetterRetryDelay); err != nil {
		slog.Error("Invalid NATS chat event could not be retried", "subject", message.Subject, "error", err)
	}
}

func (broker *NatsEventBroker) storeDeadLetter(ctx context.Context, subject string, body []byte, failure error) bool {
	deadLetterCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Second)
	defer cancel()
	if err := broker.deadLetters.Store(deadLetterCtx, subject, body, failure); err != nil {
		slog.Error("Failed to store NATS dead letter", "subject", subject, "error", err)
		return false
	}
	return true
}

func decodeStreamEvent(body []byte) (StreamEvent, error) {
	var event StreamEvent
	if err := json.Unmarshal(body, &event); err != nil {
		return StreamEvent{}, err
	}
	switch event.Type {
	case "message":
		if event.Message == nil || event.Message.ID == "" || len([]rune(event.Message.ID)) > 300 || !validUUID(event.Message.SourceID) || !validUUID(event.Message.ConnectionID) || !slices.Contains(Providers, event.Message.Provider) || event.Message.Author.ID == "" || len([]rune(event.Message.Author.ID)) > 200 || event.Message.Author.DisplayName == "" || len([]rune(event.Message.Author.DisplayName)) > 200 {
			return StreamEvent{}, errors.New("invalid chat message event")
		}
	case "message_deleted":
		if !validUUID(event.SourceID) || event.MessageID == "" || len([]rune(event.MessageID)) > 300 {
			return StreamEvent{}, errors.New("invalid chat message deletion event")
		}
	case "state":
		if !validUUID(event.SourceID) || (event.State != "connecting" && event.State != "live" && event.State != "offline" && event.State != "error") {
			return StreamEvent{}, errors.New("invalid chat source state event")
		}
	case "connection_error":
		if event.Error == nil || (event.Error.Code != "configuration_unavailable" && event.Error.Code != "overlay_not_found" && event.Error.Code != "stream_unavailable" && event.Error.Code != "transport_unavailable" && event.Error.Code != "unauthorized") {
			return StreamEvent{}, errors.New("invalid chat connection error event")
		}
	default:
		return StreamEvent{}, errors.New("invalid chat stream event type")
	}
	return event, nil
}

type DeadLetter struct {
	Sequence         string    `json:"sequence"`
	FailedAt         time.Time `json:"failedAt"`
	SourceSubject    string    `json:"sourceSubject"`
	Error            string    `json:"error"`
	Payload          []byte    `json:"payload"`
	PayloadTruncated bool      `json:"payloadTruncated"`
}

type DeadLetterPage struct {
	Items              []DeadLetter `json:"items"`
	Total              uint64       `json:"total"`
	NextBeforeSequence string       `json:"nextBeforeSequence,omitempty"`
}

type storedDeadLetter struct {
	FailedAt         time.Time `json:"failedAt"`
	SourceSubject    string    `json:"sourceSubject"`
	Error            string    `json:"error"`
	Payload          []byte    `json:"payload"`
	PayloadTruncated bool      `json:"payloadTruncated"`
}

type DeadLetterReader interface {
	List(context.Context, int, uint64) (DeadLetterPage, error)
}

type NatsDeadLetterStore struct {
	jetstream nats.JetStreamContext
	stream    string
	subject   string
}

func (store *NatsDeadLetterStore) Store(ctx context.Context, sourceSubject string, payload []byte, failure error) error {
	hash := sha256.New()
	_, _ = hash.Write([]byte(sourceSubject))
	_, _ = hash.Write([]byte{0})
	_, _ = hash.Write(payload)
	storedPayload := payload
	truncated := false
	if len(storedPayload) > chatDeadLetterPayloadLimit {
		storedPayload = storedPayload[:chatDeadLetterPayloadLimit]
		truncated = true
	}
	body, err := json.Marshal(storedDeadLetter{FailedAt: time.Now().UTC(), SourceSubject: sourceSubject, Error: failure.Error(), Payload: storedPayload, PayloadTruncated: truncated})
	if err != nil {
		return err
	}
	_, err = store.jetstream.Publish(store.subject, body, nats.Context(ctx), nats.MsgId(hex.EncodeToString(hash.Sum(nil))))
	return err
}

func (store *NatsDeadLetterStore) List(ctx context.Context, limit int, beforeSequence uint64) (DeadLetterPage, error) {
	if limit < 1 || limit > 100 {
		return DeadLetterPage{}, errors.New("dead letter page limit must be between 1 and 100")
	}
	info, err := store.jetstream.StreamInfo(store.stream, nats.Context(ctx))
	if err != nil {
		return DeadLetterPage{}, err
	}
	page := DeadLetterPage{Items: make([]DeadLetter, 0, limit), Total: info.State.Msgs}
	if info.State.Msgs == 0 {
		return page, nil
	}
	sequence := info.State.LastSeq
	if beforeSequence > 0 && beforeSequence <= sequence {
		sequence = beforeSequence - 1
	}
	for sequence >= info.State.FirstSeq && len(page.Items) < limit {
		message, getErr := store.jetstream.GetMsg(store.stream, sequence, nats.Context(ctx))
		if getErr == nil {
			var stored storedDeadLetter
			if err := json.Unmarshal(message.Data, &stored); err != nil {
				return DeadLetterPage{}, fmt.Errorf("decode dead letter %d: %w", sequence, err)
			}
			page.Items = append(page.Items, DeadLetter{Sequence: strconv.FormatUint(sequence, 10), FailedAt: stored.FailedAt, SourceSubject: stored.SourceSubject, Error: stored.Error, Payload: stored.Payload, PayloadTruncated: stored.PayloadTruncated})
		} else if !errors.Is(getErr, nats.ErrMsgNotFound) {
			return DeadLetterPage{}, getErr
		}
		if sequence == 0 {
			break
		}
		sequence--
	}
	if len(page.Items) == limit && sequence >= info.State.FirstSeq {
		page.NextBeforeSequence = strconv.FormatUint(sequence+1, 10)
	}
	return page, nil
}

type CollectorLease interface {
	Maintain(context.Context) error
	Release() error
}

type NatsCollectorLeases struct{ bucket nats.KeyValue }

func (leases *NatsCollectorLeases) Acquire(_ context.Context, key, owner string) (CollectorLease, error) {
	revision, err := leases.bucket.Create(key, []byte(owner))
	if err != nil {
		if errors.Is(err, nats.ErrKeyExists) {
			return nil, nil
		}
		return nil, err
	}
	return &natsCollectorLease{bucket: leases.bucket, key: key, owner: owner, revision: revision}, nil
}

type natsCollectorLease struct {
	bucket   nats.KeyValue
	key      string
	owner    string
	revision uint64
}

func (lease *natsCollectorLease) Maintain(ctx context.Context) error {
	ticker := time.NewTicker(collectorLeaseHeartbeat)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			revision, err := lease.bucket.Update(lease.key, []byte(lease.owner), lease.revision)
			if err != nil {
				return err
			}
			lease.revision = revision
		}
	}
}

func (lease *natsCollectorLease) Release() error {
	return lease.bucket.Delete(lease.key, nats.LastRevision(lease.revision))
}

type NatsCollectorControl struct{ bucket nats.KeyValue }

func (control *NatsCollectorControl) RequestRefresh(_ context.Context, sourceID string) error {
	_, err := control.bucket.Put(sourceID, []byte(randomID()))
	return err
}

func (control *NatsCollectorControl) Refreshes(ctx context.Context) (<-chan string, error) {
	watcher, err := control.bucket.WatchAll(nats.UpdatesOnly(), nats.IgnoreDeletes())
	if err != nil {
		return nil, err
	}
	output := make(chan string)
	go func() {
		defer close(output)
		defer watcher.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case entry, open := <-watcher.Updates():
				if !open {
					return
				}
				if entry == nil || entry.Operation() != nats.KeyValuePut {
					continue
				}
				select {
				case <-ctx.Done():
					return
				case output <- entry.Key():
				}
			}
		}
	}()
	return output, nil
}

func (broker *NatsEventBroker) userSubject(userID int) string {
	return fmt.Sprintf("%s.%d", broker.subjectPrefix, userID)
}
func sourceStateKey(userID int, sourceID string) string {
	return fmt.Sprintf("%d.%s", userID, sourceID)
}

func randomID() string {
	value := make([]byte, 16)
	_, _ = rand.Read(value)
	return hex.EncodeToString(value)
}

var _ EventBroker = (*NatsEventBroker)(nil)
var _ CollectorControl = (*NatsCollectorControl)(nil)
