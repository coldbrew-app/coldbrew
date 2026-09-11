package donatestream

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"
)

type sourceTestSocket struct {
	reads  [][]byte
	writes [][]byte
}

func (socket *sourceTestSocket) Read(context.Context) ([]byte, error) {
	if len(socket.reads) == 0 {
		return nil, errors.New("closed")
	}
	body := socket.reads[0]
	socket.reads = socket.reads[1:]
	return body, nil
}

func (socket *sourceTestSocket) Write(_ context.Context, body []byte) error {
	socket.writes = append(socket.writes, append([]byte(nil), body...))
	return nil
}

func (*sourceTestSocket) Close() error { return nil }

func TestRunSessionAuthenticatesJoinsAndEmitsDonation(t *testing.T) {
	socket := &sourceTestSocket{reads: [][]byte{
		[]byte(`0{"sid":"engine"}`),
		[]byte(`40{"sid":"socket"}`),
		[]byte(`42["auth"]`),
		[]byte(`42["authResult",{}]`),
		[]byte(`2`),
		[]byte(`42["alert",{"message_uid":"donation-1","uid":"template-1","nickname":"Supporter","message":"hello","sum":"25","currency":"RUB"}]`),
	}}
	source := NewSource()
	source.now = func() time.Time { return time.Date(2026, 9, 10, 10, 0, 0, 0, time.UTC) }
	source.dial = func(context.Context, string) (Socket, error) { return socket, nil }
	var donation Donation
	emitted, err := source.runSession(context.Background(), "widget-token", func(value Donation) error {
		donation = value
		return errors.New("stop")
	}, false)
	if err == nil || err.Error() != "stop" || emitted {
		t.Fatalf("emitted=%v err=%v", emitted, err)
	}
	expectedWrites := [][]byte{
		[]byte("40"),
		[]byte(`42["auth.token",{"token":"widget-token"}]`),
		[]byte(`42["join",{"channel":"donates"}]`),
		[]byte(`42["join",{"channel":"widget-alerts"}]`),
		[]byte("3"),
	}
	if !reflect.DeepEqual(socket.writes, expectedWrites) {
		t.Fatalf("writes=%q", socket.writes)
	}
	if donation.SourceDonationID != "donation-1" || donation.Amount != "25.00" || donation.Currency != "RUB" || !donation.OccurredAt.Equal(source.now()) {
		t.Fatalf("donation=%#v", donation)
	}
}

func TestRunSessionClassifiesAuthFailure(t *testing.T) {
	socket := &sourceTestSocket{reads: [][]byte{
		[]byte(`0{"sid":"engine"}`),
		[]byte(`42["auth"]`),
		[]byte(`42["authResult",{"error":"auth"}]`),
	}}
	source := NewSource()
	source.dial = func(context.Context, string) (Socket, error) { return socket, nil }
	_, err := source.runSession(context.Background(), "invalid", func(Donation) error { return nil }, false)
	if !isUnauthorized(err) {
		t.Fatalf("expected unauthorized error, got %v", err)
	}
}

func TestAuthenticateStopsBeforeJoiningChannels(t *testing.T) {
	socket := &sourceTestSocket{reads: [][]byte{
		[]byte(`0{"sid":"engine"}`),
		[]byte(`42["auth"]`),
		[]byte(`42["authResult",{}]`),
	}}
	source := NewSource()
	source.dial = func(context.Context, string) (Socket, error) { return socket, nil }
	if err := source.Authenticate(context.Background(), "widget-token"); err != nil {
		t.Fatal(err)
	}
	expectedWrites := [][]byte{
		[]byte("40"),
		[]byte(`42["auth.token",{"token":"widget-token"}]`),
	}
	if !reflect.DeepEqual(socket.writes, expectedWrites) {
		t.Fatalf("writes=%q", socket.writes)
	}
}

func TestDecodeEventRejectsMalformedPayload(t *testing.T) {
	if _, err := decodeEvent([]byte(`{"event":"auth"}`)); err == nil {
		t.Fatal("expected malformed event error")
	}
}
