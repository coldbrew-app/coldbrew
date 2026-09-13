package donationalerts

import (
	"context"
	"testing"
)

func TestRequestLimiterPreemptsHistoryWithCriticalRequest(t *testing.T) {
	limiter := testRequestLimiter()
	critical := testRequestPermit()
	recovery := testRequestPermit()
	regular := testRequestPermit()
	limiter.critical <- critical
	limiter.recovery <- recovery
	limiter.regular <- regular

	actual, priority := limiter.next(0, maximumRecoveryBurst)
	if priority != criticalRequest || actual.granted != critical.granted {
		t.Fatalf("next request = (%v, %d), want critical request", actual, priority)
	}
}

func TestRequestLimiterGivesRecoveryBoundedProgressDuringCriticalBurst(t *testing.T) {
	limiter := testRequestLimiter()
	critical := testRequestPermit()
	recovery := testRequestPermit()
	limiter.critical <- critical
	limiter.recovery <- recovery

	actual, priority := limiter.next(maximumCriticalBurst, 0)
	if priority != recoveryRequest || actual.granted != recovery.granted {
		t.Fatalf("next request = (%v, %d), want recovery after critical burst", actual, priority)
	}
}

func TestRequestLimiterGivesRegularHistoryBoundedProgress(t *testing.T) {
	limiter := testRequestLimiter()
	recovery := testRequestPermit()
	regular := testRequestPermit()
	limiter.recovery <- recovery
	limiter.regular <- regular

	actual, priority := limiter.next(0, maximumRecoveryBurst)
	if priority != regularRequest || actual.granted != regular.granted {
		t.Fatalf("next request = (%v, %d), want regular request after recovery burst", actual, priority)
	}
}

func testRequestLimiter() *requestLimiter {
	return &requestLimiter{
		critical: make(chan requestPermit, 1),
		recovery: make(chan requestPermit, 1),
		regular:  make(chan requestPermit, 1),
	}
}

func testRequestPermit() requestPermit {
	return requestPermit{ctx: context.Background(), granted: make(chan struct{}, 1)}
}
