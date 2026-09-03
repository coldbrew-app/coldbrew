# ADR 0003: Native TypeScript errors

- Status: accepted
- Date: 2026-09-03

## Context

The TypeScript application used Neverthrow for HTTP calls, sequential workflows, and event
streams. This introduced a second control-flow model alongside promises, exceptions, async
iterators, tRPC errors, and Go's native errors. Callers repeatedly unwrapped results or carried
`Result` values through layers that already have native failure channels.

Some of the supporting abstractions existed only for a retired TypeScript DonationAlerts realtime
collector. The active collector is implemented by the Go donations service.

## Decision

TypeScript code uses native exceptions and promise rejection. Foreign-service adapters expose
typed `Error` subclasses with structured metadata and preserve upstream failures as `cause`.
Long-running sources expose `AsyncIterable<T>`, yield only domain values, and throw terminal
errors. Cancellation is normal completion.

Shared HTTP helpers own fetch, status checking, JSON decoding, and Zod validation. Public tRPC
boundaries translate known adapter errors into `TRPCError`; unknown exceptions remain internal
errors.

The Neverthrow dependencies, utilities, guide, result-stream abstraction, and retired TypeScript
DonationAlerts realtime and refresh-token paths are removed.

## Consequences

- Async code uses one control-flow model throughout the TypeScript application.
- Service errors retain machine-readable fields and causal chains without becoming wire values.
- Tests assert resolved values and rejected typed errors directly.
- Reintroducing Neverthrow packages is rejected by lint configuration.
