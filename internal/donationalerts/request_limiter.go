package donationalerts

import (
	"context"
	"time"
)

type requestPermit struct {
	ctx     context.Context
	granted chan struct{}
}

type requestPriority uint8

const (
	regularRequest requestPriority = iota
	recoveryRequest
	criticalRequest
	maximumCriticalBurst = 4
	maximumRecoveryBurst = 4
)

// requestLimiter serializes every REST request made by one DonationAlerts
// client. OAuth, token refresh, and listener setup usually preempt history,
// but a history request gets a permit after at most four consecutive critical
// requests. Recent recovery gets four of every five history permits while
// regular history still makes bounded progress.
type requestLimiter struct {
	interval time.Duration
	critical chan requestPermit
	recovery chan requestPermit
	regular  chan requestPermit
}

func newRequestLimiter(interval time.Duration) *requestLimiter {
	limiter := &requestLimiter{
		interval: interval,
		critical: make(chan requestPermit),
		recovery: make(chan requestPermit),
		regular:  make(chan requestPermit),
	}
	go limiter.run()
	return limiter
}

func (limiter *requestLimiter) wait(ctx context.Context, priority requestPriority) error {
	permit := requestPermit{ctx: ctx, granted: make(chan struct{}, 1)}
	queue := limiter.regular
	switch priority {
	case recoveryRequest:
		queue = limiter.recovery
	case criticalRequest:
		queue = limiter.critical
	}
	select {
	case queue <- permit:
	case <-ctx.Done():
		return ctx.Err()
	}
	select {
	case <-permit.granted:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (limiter *requestLimiter) run() {
	criticalBurst := 0
	recoveryBurst := 0
	for {
		permit, priority := limiter.next(criticalBurst, recoveryBurst)
		if permit.ctx.Err() != nil {
			continue
		}
		permit.granted <- struct{}{}
		if priority == criticalRequest {
			criticalBurst++
		} else {
			criticalBurst = 0
		}
		if priority == recoveryRequest {
			recoveryBurst++
		} else if priority == regularRequest {
			recoveryBurst = 0
		}
		if limiter.interval > 0 {
			time.Sleep(limiter.interval)
		}
	}
}

func (limiter *requestLimiter) next(criticalBurst, recoveryBurst int) (requestPermit, requestPriority) {
	if criticalBurst < maximumCriticalBurst {
		select {
		case permit := <-limiter.critical:
			return permit, criticalRequest
		default:
		}
	}
	if criticalBurst >= maximumCriticalBurst {
		if permit, priority, ok := limiter.nextHistory(recoveryBurst); ok {
			return permit, priority
		}
	}
	select {
	case permit := <-limiter.critical:
		return permit, criticalRequest
	default:
	}
	if permit, priority, ok := limiter.nextHistory(recoveryBurst); ok {
		return permit, priority
	}
	select {
	case permit := <-limiter.critical:
		return permit, criticalRequest
	case permit := <-limiter.recovery:
		return permit, recoveryRequest
	case permit := <-limiter.regular:
		return permit, regularRequest
	}
}

func (limiter *requestLimiter) nextHistory(recoveryBurst int) (requestPermit, requestPriority, bool) {
	if recoveryBurst >= maximumRecoveryBurst {
		select {
		case permit := <-limiter.regular:
			return permit, regularRequest, true
		default:
		}
	}
	select {
	case permit := <-limiter.recovery:
		return permit, recoveryRequest, true
	default:
	}
	select {
	case permit := <-limiter.regular:
		return permit, regularRequest, true
	default:
	}
	return requestPermit{}, regularRequest, false
}
