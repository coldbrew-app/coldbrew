package chat

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/nats-io/nats.go"
)

const (
	chatStream                    = "CHAT_EVENTS"
	chatSubjectPrefix             = "chat.user"
	collectorLeaseBucket          = "chat_collectors"
	chatStateBucket               = "chat_source_states"
	collectorRefreshBucket        = "chat_collector_refreshes"
	chatEventMaxAge               = 15 * time.Minute
	chatEventMaxPerUser     int64 = 2500
	chatDuplicateWindow           = 2 * time.Minute
	collectorLeaseTTL             = 30 * time.Second
	collectorLeaseHeartbeat       = 10 * time.Second
)

var (
	natsNamespacePattern         = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,47}$`)
	worktreeNatsNamespacePattern = regexp.MustCompile(`^wt_[0-9a-f]{8}$`)
	worktreeNatsStreamPattern    = regexp.MustCompile(`^(WT_[0-9A-F]{8})_CHAT_EVENTS$`)
	worktreeNatsKeyValuePattern  = regexp.MustCompile(`^(wt_[0-9a-f]{8})_chat_(collectors|source_states|collector_refreshes)$`)
)

type natsResources struct {
	stream                 string
	subjectPrefix          string
	collectorLeaseBucket   string
	chatStateBucket        string
	collectorRefreshBucket string
}

func resourcesForNamespace(namespace string) (natsResources, error) {
	if namespace == "" {
		return natsResources{
			stream:                 chatStream,
			subjectPrefix:          chatSubjectPrefix,
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
	return &NatsConnection{connection: connection, Broker: &NatsEventBroker{connection: connection, jetstream: jetstream, states: states, subjectPrefix: resources.subjectPrefix}, Leases: &NatsCollectorLeases{bucket: leases}, CollectorControl: &NatsCollectorControl{bucket: refreshes}}, nil
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
	if err := jetstream.DeleteStream(resources.stream); err != nil && !errors.Is(err, nats.ErrStreamNotFound) {
		return err
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
	connection    *nats.Conn
	jetstream     nats.JetStreamContext
	states        nats.KeyValue
	subjectPrefix string
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
	subscription, err := broker.connection.ChanSubscribe(broker.userSubject(userID), messages)
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
			if !sendEvent(ctx, output, entry.Value()) {
				return
			}
		}
		for {
			select {
			case <-ctx.Done():
				return
			case message, open := <-messages:
				if !open || !sendEvent(ctx, output, message.Data) {
					return
				}
			}
		}
	}()
	return output
}

func sendEvent(ctx context.Context, output chan<- StreamEvent, body []byte) bool {
	var event StreamEvent
	if err := json.Unmarshal(body, &event); err != nil {
		return true
	}
	select {
	case <-ctx.Done():
		return false
	case output <- event:
		return true
	}
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
