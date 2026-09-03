# 0004. Donation source responsibilities follow runtime lifecycle

## Status

Accepted.

## Context

DonationAlerts OAuth is initiated by an authenticated web user, while token
refresh, history synchronization, and realtime collection are long-running
background work. Keeping the OAuth exchange in a private worker would require
an otherwise unnecessary internal HTTP API.

## Decision

`apps/web` owns the DonationAlerts OAuth authorization URL, callback, token
exchange, and connection lifecycle. It validates DonationAlerts responses with
Zod and stores the resulting connection for the authenticated user.

`apps/donations` owns long-running donation-source work. Its first integration
refreshes DonationAlerts tokens, imports donation history, collects realtime
donations, and writes them to the database. It is a worker and exposes no HTTP
API.

The existing session-linked callback remains unchanged and does not add an
OAuth `state` parameter. This preserves current behavior but retains the known
login-CSRF risk until the flow is explicitly hardened.

## Consequences

The web and donations processes both receive the DonationAlerts OAuth client
credentials. The web process writes connections, while the donations worker
detects their token-version changes. Only one donations replica may run until
collector leadership is introduced.
