# 0004. Donation integration module owns provider lifecycle

## Status

Accepted (supersedes the original web-owned OAuth mechanics decision)

## Context

Donation provider OAuth is initiated by an authenticated web user, while code exchange, profile
loading, history synchronization, token refresh, and realtime collection form one credential
lifecycle. Splitting that lifecycle between `apps/web` and `apps/donations` exposed credentials and
transaction invariants at two seams. It also allowed an OAuth callback to report success before the
initial donation history was imported.

## Decision

`apps/web` owns Coldbrew authentication and the public authorization and callback routes.
Streamlabs authorization uses a random `state` stored in a signed, HttpOnly, SameSite cookie and
consumes it in the callback. The older DonationAlerts flow remains linked to the authenticated
session but does not yet send `state` because that provider adapter predates this decision.

The provider-independent application layer in `internal/donations` owns OAuth code exchange,
profile loading, connection lifecycle, initial and periodic history import, token refresh, realtime
collection, and donation persistence. DonationAlerts and Streamlabs implement small provider
adapters. `apps/donations` composes those adapters and runs the HTTP server and workers under one
cancellation context.

The module exposes a private JSON interface authenticated with `DONATIONS_SERVICE_SECRET`.
`apps/web` sends the authenticated Coldbrew user ID, authorization code, and exact public callback
URL to that interface. Connecting performs code exchange, profile loading, and complete history
loading before atomically storing the connection and idempotent donations. A history failure stores
neither connection nor donations.

The PostgreSQL adapter owns connection transactions and token-version compare-and-swap operations.
Realtime listeners are replaced when a reconnect increments `token_version`; stale refreshes cannot
overwrite or disconnect a newer connection.

## Consequences

The donations module constructs provider authorization URLs and owns DonationAlerts and Streamlabs
client credentials. `apps/web` uses only `DONATIONS_SERVICE_URL` and the shared
`DONATIONS_SERVICE_SECRET` for these integrations.

The initial history is visible as soon as the public callback reports success, at the cost of making
that callback wait for all provider history pages. Streamlabs socket events wake an authoritative
REST reconciliation because its event payload omits the source creation timestamp. Only one
donations replica may run until collector leadership is introduced.

The missing OAuth `state` in the legacy DonationAlerts flow remains a known login-CSRF risk and must
be addressed by a separate hardening decision. New provider adapters must not copy that exception.
