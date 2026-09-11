package donationalerts

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/coder/websocket"
)

const (
	methodConnect    = 0
	methodSubscribe  = 1
	methodPing       = 7
	methodRefresh    = 10
	methodSubRefresh = 11

	pushPublication = 0
	pushJoin        = 1
	pushLeave       = 2
	pushUnsubscribe = 3
	pushMessage     = 4
	pushSubscribe   = 5
	pushConnect     = 6
	pushDisconnect  = 7
	pushRefresh     = 8

	maxSocketMessageBytes = 1 << 20
)

type streamPosition struct {
	epoch      string
	sequence   uint32
	generation uint32
	valid      bool
}

type socketSession struct {
	url                      string
	connectionToken          string
	channel                  string
	position                 streamPosition
	pingInterval             time.Duration
	commandTimeout           time.Duration
	refreshConnectionToken   func(context.Context) (string, error)
	refreshSubscriptionToken func(context.Context, string) (string, error)
	onPublication            func([]byte) error
}

type commandKind string

const (
	commandConnect    commandKind = "connect"
	commandSubscribe  commandKind = "subscribe"
	commandPing       commandKind = "ping"
	commandRefresh    commandKind = "refresh"
	commandSubRefresh commandKind = "subscription refresh"
)

type pendingCommand struct {
	kind     commandKind
	deadline time.Time
}

type socketCommand struct {
	ID     uint64 `json:"id,omitempty"`
	Method int    `json:"method,omitempty"`
	Params any    `json:"params,omitempty"`
}

type socketReply struct {
	ID     uint64          `json:"id"`
	Error  *protocolError  `json:"error"`
	Result json.RawMessage `json:"result"`
}

type protocolError struct {
	Code    uint32 `json:"code"`
	Message string `json:"message"`
}

type connectResult struct {
	Client  string `json:"client"`
	Version string `json:"version"`
	Expires bool   `json:"expires"`
	TTL     uint32 `json:"ttl"`
}

type subscriptionResult struct {
	Expires      bool                `json:"expires"`
	TTL          uint32              `json:"ttl"`
	Recoverable  bool                `json:"recoverable"`
	Sequence     uint32              `json:"seq"`
	Generation   uint32              `json:"gen"`
	Epoch        string              `json:"epoch"`
	Publications []socketPublication `json:"publications"`
	Recovered    bool                `json:"recovered"`
}

type refreshResult struct {
	Expires bool   `json:"expires"`
	TTL     uint32 `json:"ttl"`
}

type socketPush struct {
	Type    *int            `json:"type"`
	Channel string          `json:"channel"`
	Data    json.RawMessage `json:"data"`
}

type socketPublication struct {
	Sequence   uint32          `json:"seq"`
	Generation uint32          `json:"gen"`
	Data       json.RawMessage `json:"data"`
}

type socketClientEvent struct {
	Info *struct {
		User   string `json:"user"`
		Client string `json:"client"`
	} `json:"info"`
}

type socketUnsubscribe struct {
	Resubscribe bool `json:"resubscribe"`
}

type socketDisconnect struct {
	Reason    string `json:"reason"`
	Reconnect bool   `json:"reconnect"`
}

type socketRead struct {
	body []byte
	err  error
}

type disconnectAdvice struct {
	Reason    string `json:"reason"`
	Reconnect bool   `json:"reconnect"`
}

type transportError struct{ cause error }

func (err *transportError) Error() string { return err.cause.Error() }
func (err *transportError) Unwrap() error { return err.cause }

func isTransportError(err error) bool {
	var target *transportError
	return errors.As(err, &target)
}

func (session socketSession) run(ctx context.Context) (sessionResult, error) {
	result := sessionResult{position: session.position}
	if session.pingInterval <= 0 || session.commandTimeout <= 0 {
		return result, errors.New("invalid DonationAlerts websocket timing configuration")
	}

	connection, _, err := websocket.Dial(ctx, session.url, nil)
	if err != nil {
		return result, &transportError{cause: fmt.Errorf("open DonationAlerts websocket: %w", err)}
	}
	connection.SetReadLimit(maxSocketMessageBytes)
	sessionCtx, cancel := context.WithCancel(ctx)
	reads, readerDone := readSocketMessages(sessionCtx, connection)
	defer func() {
		cancel()
		_ = connection.CloseNow()
		<-readerDone
	}()

	nextID := uint64(0)
	pending := make(map[uint64]pendingCommand)
	send := func(method int, kind commandKind, params any) error {
		nextID++
		body, err := json.Marshal(socketCommand{ID: nextID, Method: method, Params: params})
		if err != nil {
			return fmt.Errorf("encode DonationAlerts %s command: %w", kind, err)
		}
		writeCtx, writeCancel := context.WithTimeout(sessionCtx, session.commandTimeout)
		defer writeCancel()
		if err := connection.Write(writeCtx, websocket.MessageText, body); err != nil {
			return &transportError{cause: fmt.Errorf("write DonationAlerts %s command: %w", kind, err)}
		}
		pending[nextID] = pendingCommand{kind: kind, deadline: time.Now().Add(session.commandTimeout)}
		return nil
	}
	if err := send(methodConnect, commandConnect, map[string]string{"token": session.connectionToken}); err != nil {
		return result, err
	}

	var socketClientID string
	var connectionRefresh <-chan time.Time
	var connectionRefreshTimer *time.Timer
	var subscriptionRefresh <-chan time.Time
	var subscriptionRefreshTimer *time.Timer
	var ping <-chan time.Time
	var pingTimer *time.Timer
	defer func() {
		stopTimer(connectionRefreshTimer)
		stopTimer(subscriptionRefreshTimer)
		stopTimer(pingTimer)
	}()
	timeoutInterval := min(session.commandTimeout/4, time.Second)
	if timeoutInterval < time.Millisecond {
		timeoutInterval = time.Millisecond
	}
	timeoutTicker := time.NewTicker(timeoutInterval)
	defer timeoutTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			return result, nil
		case read, ok := <-reads:
			if !ok {
				if ctx.Err() != nil {
					return result, nil
				}
				return result, &transportError{cause: errors.New("DonationAlerts websocket reader stopped")}
			}
			if read.err != nil {
				if ctx.Err() != nil {
					return result, nil
				}
				return result, classifySocketReadError(read.err)
			}
			if len(read.body) == 0 {
				continue
			}
			if pingTimer != nil {
				resetTimer(pingTimer, session.pingInterval)
				ping = pingTimer.C
			}
			var envelope map[string]json.RawMessage
			if err := json.Unmarshal(read.body, &envelope); err != nil || envelope == nil {
				if err == nil {
					err = errors.New("expected JSON object")
				}
				return result, fmt.Errorf("invalid DonationAlerts websocket message: %w; raw message: %s", err, read.body)
			}
			if len(envelope) == 0 {
				logUnhandledSocketMessage(ctx, read.body, 0, nil, "", "empty protocol message")
				continue
			}

			var reply socketReply
			if err := json.Unmarshal(read.body, &reply); err != nil {
				return result, fmt.Errorf("invalid DonationAlerts websocket message: %w; raw message: %s", err, read.body)
			}
			if reply.ID == 0 {
				if err := session.handlePush(ctx, reply.Result, read.body, &result); err != nil {
					return result, err
				}
				continue
			}
			command, ok := pending[reply.ID]
			if !ok {
				logUnhandledSocketMessage(ctx, read.body, reply.ID, nil, "", "reply id is not pending")
				continue
			}
			delete(pending, reply.ID)
			if reply.Error != nil {
				return result, fmt.Errorf("DonationAlerts %s command failed with code %d: %s; raw message: %s", command.kind, reply.Error.Code, reply.Error.Message, read.body)
			}

			switch command.kind {
			case commandConnect:
				var connected connectResult
				if err := decodeResult(reply.Result, &connected, command.kind, read.body); err != nil {
					return result, err
				}
				if connected.Client == "" || connected.Version == "" {
					return result, fmt.Errorf("invalid DonationAlerts connect result: missing client or version; raw message: %s", read.body)
				}
				socketClientID = connected.Client
				connectionRefreshTimer, err = refreshTimer(connectionRefreshTimer, connected.Expires, connected.TTL, "connection", read.body)
				if err != nil {
					return result, err
				}
				connectionRefresh = timerChannel(connectionRefreshTimer)
				if pingTimer == nil {
					pingTimer = time.NewTimer(session.pingInterval)
					ping = pingTimer.C
				}
				tokenCtx, tokenCancel := context.WithTimeout(sessionCtx, session.commandTimeout)
				token, err := session.refreshSubscriptionToken(tokenCtx, socketClientID)
				tokenCancel()
				if err != nil {
					return result, err
				}
				params := map[string]any{"channel": session.channel, "token": token}
				if result.position.valid {
					params["recover"] = true
					params["epoch"] = result.position.epoch
					params["seq"] = result.position.sequence
					params["gen"] = result.position.generation
				}
				if err := send(methodSubscribe, commandSubscribe, params); err != nil {
					return result, err
				}
			case commandSubscribe:
				var subscribed subscriptionResult
				if err := decodeResult(reply.Result, &subscribed, command.kind, read.body); err != nil {
					return result, err
				}
				if subscribed.Recoverable && subscribed.Epoch == "" {
					return result, fmt.Errorf("invalid DonationAlerts subscribe result: missing recovery epoch; raw message: %s", read.body)
				}
				attemptedRecovery := result.position.valid
				previousPosition := result.position
				result.subscribed = true
				subscriptionRefreshTimer, err = refreshTimer(subscriptionRefreshTimer, subscribed.Expires, subscribed.TTL, "subscription", read.body)
				if err != nil {
					return result, err
				}
				subscriptionRefresh = timerChannel(subscriptionRefreshTimer)
				publications := subscribed.Publications
				if len(publications) > 1 {
					publications = append([]socketPublication(nil), publications...)
					reversePublications(publications)
				}
				baseline := streamPosition{
					epoch:      subscribed.Epoch,
					sequence:   subscribed.Sequence,
					generation: subscribed.Generation,
					valid:      subscribed.Recoverable,
				}
				if attemptedRecovery && subscribed.Recovered {
					result.position = previousPosition
				} else {
					result.position = streamPosition{epoch: baseline.epoch, valid: baseline.valid}
				}
				if attemptedRecovery && !subscribed.Recovered {
					slog.WarnContext(ctx, "DonationAlerts subscription could not fully recover",
						"previousEpoch", previousPosition.epoch,
						"previousSequence", previousPosition.sequence,
						"previousGeneration", previousPosition.generation,
						"currentEpoch", baseline.epoch,
						"currentSequence", baseline.sequence,
						"currentGeneration", baseline.generation,
						"rawMessage", string(read.body),
					)
				}
				for _, publication := range publications {
					if err := session.emitPublication(ctx, publication, read.body, &result); err != nil {
						return result, err
					}
				}
				result.position = baseline
			case commandPing:
				// A successful correlated reply is the heartbeat acknowledgement.
			case commandRefresh:
				var refreshed refreshResult
				if err := decodeResult(reply.Result, &refreshed, command.kind, read.body); err != nil {
					return result, err
				}
				connectionRefreshTimer, err = refreshTimer(connectionRefreshTimer, refreshed.Expires, refreshed.TTL, "connection", read.body)
				if err != nil {
					return result, err
				}
				connectionRefresh = timerChannel(connectionRefreshTimer)
			case commandSubRefresh:
				var refreshed refreshResult
				if err := decodeResult(reply.Result, &refreshed, command.kind, read.body); err != nil {
					return result, err
				}
				subscriptionRefreshTimer, err = refreshTimer(subscriptionRefreshTimer, refreshed.Expires, refreshed.TTL, "subscription", read.body)
				if err != nil {
					return result, err
				}
				subscriptionRefresh = timerChannel(subscriptionRefreshTimer)
			}

		case <-connectionRefresh:
			connectionRefresh = nil
			tokenCtx, tokenCancel := context.WithTimeout(sessionCtx, session.commandTimeout)
			token, err := session.refreshConnectionToken(tokenCtx)
			tokenCancel()
			if err != nil {
				return result, err
			}
			if err := send(methodRefresh, commandRefresh, map[string]string{"token": token}); err != nil {
				return result, err
			}

		case <-subscriptionRefresh:
			subscriptionRefresh = nil
			tokenCtx, tokenCancel := context.WithTimeout(sessionCtx, session.commandTimeout)
			token, err := session.refreshSubscriptionToken(tokenCtx, socketClientID)
			tokenCancel()
			if err != nil {
				return result, err
			}
			if err := send(methodSubRefresh, commandSubRefresh, map[string]string{"channel": session.channel, "token": token}); err != nil {
				return result, err
			}

		case <-ping:
			ping = nil
			if !hasPendingCommand(pending, commandPing) {
				if err := send(methodPing, commandPing, nil); err != nil {
					return result, err
				}
			}

		case now := <-timeoutTicker.C:
			for id, command := range pending {
				if !now.Before(command.deadline) {
					return result, &transportError{cause: fmt.Errorf("DonationAlerts %s command %d timed out after %s", command.kind, id, session.commandTimeout)}
				}
			}
		}
	}
}

func readSocketMessages(ctx context.Context, connection *websocket.Conn) (<-chan socketRead, <-chan struct{}) {
	reads := make(chan socketRead, 64)
	done := make(chan struct{})
	go func() {
		defer close(reads)
		defer close(done)
		for {
			_, body, err := connection.Read(ctx)
			if err != nil {
				select {
				case reads <- socketRead{err: err}:
				case <-ctx.Done():
				}
				return
			}
			for _, message := range bytes.Split(body, []byte{'\n'}) {
				message = bytes.TrimSpace(message)
				if len(message) == 0 {
					continue
				}
				copied := append([]byte(nil), message...)
				select {
				case reads <- socketRead{body: copied}:
				case <-ctx.Done():
					return
				}
			}
		}
	}()
	return reads, done
}

func classifySocketReadError(err error) error {
	var closeError websocket.CloseError
	if errors.As(err, &closeError) {
		var advice disconnectAdvice
		if json.Unmarshal([]byte(closeError.Reason), &advice) == nil && advice.Reason != "" {
			wrapped := fmt.Errorf("DonationAlerts websocket closed with code %d: %s", closeError.Code, advice.Reason)
			if advice.Reconnect {
				return &transportError{cause: wrapped}
			}
			return wrapped
		}
	}
	return &transportError{cause: fmt.Errorf("read DonationAlerts websocket: %w", err)}
}

func decodeResult(body json.RawMessage, target any, kind commandKind, raw []byte) error {
	if len(body) == 0 {
		return fmt.Errorf("invalid DonationAlerts %s result: missing result; raw message: %s", kind, raw)
	}
	if err := json.Unmarshal(body, target); err != nil {
		return fmt.Errorf("invalid DonationAlerts %s result: %w; raw message: %s", kind, err, raw)
	}
	return nil
}

func refreshTimer(existing *time.Timer, expires bool, ttl uint32, name string, raw []byte) (*time.Timer, error) {
	stopTimer(existing)
	if !expires {
		return nil, nil
	}
	if ttl == 0 {
		return nil, fmt.Errorf("invalid DonationAlerts %s refresh TTL; raw message: %s", name, raw)
	}
	duration := time.Duration(ttl) * time.Second
	lead := min(duration/10, 10*time.Second)
	if lead < 100*time.Millisecond {
		lead = 100 * time.Millisecond
	}
	if lead >= duration {
		lead = duration / 2
	}
	return time.NewTimer(duration - lead), nil
}

func timerChannel(timer *time.Timer) <-chan time.Time {
	if timer == nil {
		return nil
	}
	return timer.C
}

func stopTimer(timer *time.Timer) {
	if timer == nil {
		return
	}
	if !timer.Stop() {
		select {
		case <-timer.C:
		default:
		}
	}
}

func hasPendingCommand(pending map[uint64]pendingCommand, kind commandKind) bool {
	for _, command := range pending {
		if command.kind == kind {
			return true
		}
	}
	return false
}

func resetTimer(timer *time.Timer, duration time.Duration) {
	stopTimer(timer)
	timer.Reset(duration)
}

func reversePublications(publications []socketPublication) {
	for left, right := 0, len(publications)-1; left < right; left, right = left+1, right-1 {
		publications[left], publications[right] = publications[right], publications[left]
	}
}

func (session socketSession) handlePush(ctx context.Context, body json.RawMessage, raw []byte, result *sessionResult) error {
	if len(body) == 0 {
		return fmt.Errorf("invalid DonationAlerts websocket push: missing result; raw message: %s", raw)
	}
	var push socketPush
	if err := json.Unmarshal(body, &push); err != nil {
		return fmt.Errorf("invalid DonationAlerts websocket push: %w; raw message: %s", err, raw)
	}
	pushType := pushPublication
	if push.Type != nil {
		pushType = *push.Type
	}
	switch pushType {
	case pushPublication:
		if push.Channel != session.channel {
			logUnhandledSocketMessage(ctx, raw, 0, &pushType, push.Channel, "publication belongs to another channel")
			return nil
		}
		var publication socketPublication
		if err := json.Unmarshal(push.Data, &publication); err != nil {
			logUnhandledSocketMessage(ctx, raw, 0, &pushType, push.Channel, fmt.Sprintf("invalid publication: %v", err))
			return nil
		}
		if len(publication.Data) == 0 {
			logUnhandledSocketMessage(ctx, raw, 0, &pushType, push.Channel, "invalid publication: missing data")
			advancePosition(result, publication)
			return nil
		}
		return session.emitPublication(ctx, publication, raw, result)
	case pushJoin, pushLeave:
		var event socketClientEvent
		if err := json.Unmarshal(push.Data, &event); err != nil || event.Info == nil || event.Info.User == "" || event.Info.Client == "" || push.Channel == "" {
			reason := "invalid client event"
			if err != nil {
				reason = err.Error()
			}
			logUnhandledSocketMessage(ctx, raw, 0, &pushType, push.Channel, reason)
		}
		return nil
	case pushUnsubscribe:
		var unsubscribe socketUnsubscribe
		if err := json.Unmarshal(push.Data, &unsubscribe); err != nil {
			return fmt.Errorf("invalid DonationAlerts unsubscribe push: %w; raw message: %s", err, raw)
		}
		err := fmt.Errorf("DonationAlerts server cancelled channel %q subscription; resubscribe=%t; raw message: %s", push.Channel, unsubscribe.Resubscribe, raw)
		if unsubscribe.Resubscribe {
			return &transportError{cause: err}
		}
		return err
	case pushMessage, pushSubscribe:
		logUnhandledSocketMessage(ctx, raw, 0, &pushType, push.Channel, "push is not used by the DonationAlerts integration")
		return nil
	case pushDisconnect:
		var disconnect socketDisconnect
		if err := json.Unmarshal(push.Data, &disconnect); err != nil {
			return fmt.Errorf("invalid DonationAlerts disconnect push: %w; raw message: %s", err, raw)
		}
		err := fmt.Errorf("DonationAlerts server disconnected the websocket: %s; raw message: %s", disconnect.Reason, raw)
		if disconnect.Reconnect {
			return &transportError{cause: err}
		}
		return err
	case pushConnect, pushRefresh:
		logUnhandledSocketMessage(ctx, raw, 0, &pushType, push.Channel, "push is not used by the Centrifugo v2 client")
		return nil
	default:
		logUnhandledSocketMessage(ctx, raw, 0, &pushType, push.Channel, "unknown push type")
		return nil
	}
}

func (session socketSession) emitPublication(ctx context.Context, publication socketPublication, raw []byte, result *sessionResult) error {
	if len(publication.Data) == 0 {
		return fmt.Errorf("invalid DonationAlerts publication: missing data; raw message: %s", raw)
	}
	if err := session.onPublication(publication.Data); err != nil {
		var invalid *invalidDonationError
		if errors.As(err, &invalid) {
			pushType := pushPublication
			logUnhandledSocketMessage(ctx, raw, 0, &pushType, session.channel, err.Error())
			advancePosition(result, publication)
			return nil
		}
		return fmt.Errorf("process DonationAlerts donation: %w; raw message: %s", err, raw)
	}
	result.emitted = true
	advancePosition(result, publication)
	return nil
}

func advancePosition(result *sessionResult, publication socketPublication) {
	if !result.position.valid {
		return
	}
	result.position.sequence = publication.Sequence
	result.position.generation = publication.Generation
}

func logUnhandledSocketMessage(ctx context.Context, body []byte, id uint64, pushType *int, channel, reason string) {
	attributes := []any{"reason", reason, "rawMessage", string(body)}
	if id != 0 {
		attributes = append(attributes, "id", id)
	}
	if pushType != nil {
		attributes = append(attributes, "type", *pushType)
	}
	if channel != "" {
		attributes = append(attributes, "channel", channel)
	}
	slog.WarnContext(ctx, "DonationAlerts websocket message ignored", attributes...)
}
