# ADR 0001: Separate chat aggregation module

- Status: accepted; direct browser access superseded by ADR 0002
- Date: 2026-08-30

## Context

The original multichat reads public YouTube URLs inside the web process. Adding authenticated
Twitch, YouTube, Kick, Boosty, and VK Video accounts introduces credential ownership, provider
webhooks, moderation commands, broadcast messages, and long-lived collectors. A process-local
collector registry also prevents safe horizontal scaling of the web application.

## Decision

Create `apps/chat` as the chat aggregation module. It owns provider OAuth credentials, canonical
chat sources, collection, webhook verification, normalization, moderation, broadcast messages,
and the moderation audit.

The module exposes a tRPC interface. `apps/web` issues a short-lived signed ticket for the current
Coldbrew user; the browser uses that ticket to communicate directly with the chat aggregation
module. Credentials are never returned through the interface.

NATS JetStream carries normalized transient chat events between horizontally scaled instances.
PostgreSQL stores provider connections, source configuration, OAuth attempts, and moderation
actions, but not chat history.

A user can hold multiple connections for the same provider. Every chat source belongs to one
connection. Arbitrary public chat URLs are removed.
The legacy `chat_overlay_source` table remains during the non-destructive rollout, but no
application path reads or writes it.

Broadcast messages are parallel best-effort operations. Each writable source returns its own
success or failure, and successful sends are not rolled back when another provider fails.

Boosty and VK Video are modelled as read-only targets, but stay release-gated until stable official
read contracts and application credentials are available. Arbitrary URL or cookie-based scraping
is not a fallback.

## Consequences

- Provider mechanics gain locality inside `apps/chat`; `apps/web` no longer owns collectors.
- Collector identity includes the connection, preventing credentials from being shared between
  users who watch the same provider channel.
- The deployment gains NATS and a separately scalable chat process.
- Cross-provider commands are explicitly non-transactional and require partial-result UI.
- OAuth configuration and provider contract tests become prerequisites for enabling a provider.
- YouTube offline discovery is user-triggered instead of consuming project quota continuously.
