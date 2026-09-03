# Multichat

`apps/chat` owns chat aggregation. `apps/web` owns the public chat tRPC interface, authenticates
the Coldbrew user, validates chat inputs and outputs with Zod, and relays commands and live events.
The browser uses the same `/api/trpc` client as the rest of the application and never connects to
`apps/chat` directly.

The product accepts only provider accounts owned by the streamer and connected through OAuth.
Multiple accounts from the same provider are supported. The old arbitrary live-stream URL editor
is no longer used. Its legacy PostgreSQL table remains during the non-destructive rollout, but no
application path reads or writes it.

## Runtime shape

```text
browser ── session ──► apps/web tRPC ── authenticated JSON/NDJSON ──► apps/chat
                                                                          │
                                                             ┌────────────┴────────────┐
                                                             │                         │
                                                      PostgreSQL                 NATS JetStream
                                                 connections, sources,      live events and leases
                                                  encrypted tokens,                  │
                                                   moderation audit        provider collectors/webhooks
```

The Go provider adapters expose one normalized stream of `StreamEvent` values and provider errors,
plus send and moderation commands. The application layer is provider-agnostic and uses declared
capabilities instead of provider conditionals. A broadcast starts all supported sends
concurrently, returns one result per source, and never rolls back successful sends when another
provider fails.

Every pull collector owns a NATS KV lease keyed by `chat_source_id`. The lease has a 30-second TTL
and a 10-second heartbeat. This permits multiple `apps/chat` replicas while keeping exactly one
active collector per source under normal operation. JetStream deduplicates provider events by
their source/message identity and retains a short, bounded transient window. Browser subscribers
receive the live NATS subject for their Coldbrew user. The latest source state is cached in a
short-lived NATS KV bucket so a newly opened editor does not incorrectly show an active source as
offline; an incoming provider message also marks that source live.

Messages are never written to PostgreSQL. The browser keeps at most 500 normalized messages.
PostgreSQL stores command audit rows without message text: provider, source, action, provider
message/user ID, duration, status, safe detail, and timestamp. Disconnecting an account does not
delete those audit rows.

YouTube performs active-broadcast discovery once when its collector starts. If the channel is
offline or the broadcast ends, discovery remains idle until the streamer selects **Check stream**
for that source. The command is distributed through NATS so it reaches the replica that owns the
collector lease. Transport failures during an active operation still reconnect automatically with
bounded exponential backoff.

## Provider capabilities

| Provider | Read          | Send | Delete | Timeout / ban / unban | Collection                                                                       |
| -------- | ------------- | ---- | ------ | --------------------- | -------------------------------------------------------------------------------- |
| YouTube  | yes           | yes  | yes    | yes                   | manual active-broadcast discovery + server-streaming live chat                   |
| Twitch   | yes           | yes  | yes    | yes                   | EventSub WebSocket                                                               |
| Kick     | yes           | yes  | yes    | yes                   | signed `chat.message.sent` webhook                                               |
| Boosty   | release-gated | no   | no     | no                    | read-only target; no stable public official chat API                             |
| VK Video | release-gated | no   | no     | no                    | read-only target; requires a registered VK application and verified API contract |

Boosty and VK Video already exist in the shared provider/capability model and UI availability
response, but their connect buttons remain disabled until an official read contract can be
implemented without scraping or user cookies. This is an intentional product limitation, not a
fallback to arbitrary URLs.

## OAuth and credentials

OAuth attempts use random state, PKCE-S256, a ten-minute expiry, and single-use rows. Provider
access and refresh tokens are encrypted with AES-256-GCM before storage. Chat credentials are
separate from Better Auth sign-in accounts.

Token refresh is centralized in the chat service. Updates use `token_version` as a compare-and-swap
guard so concurrent replicas cannot overwrite a newer token. Provider calls retry with the next
collector/config snapshot after a refresh race.

Required service settings:

```text
DATABASE_URL
NATS_SERVERS
CHAT_PORT
CHAT_PUBLIC_URL
CHAT_WEB_URL
```

`apps/web` additionally requires `CHAT_SERVICE_URL`.

Provider settings are enabled as complete groups:

```text
YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET
TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET
KICK_CLIENT_ID / KICK_CLIENT_SECRET / KICK_WEBHOOK_PUBLIC_KEY
```

`CHAT_SERVICE_SECRET` must have the same value in `apps/web` and `apps/chat`. It authenticates the
private service-to-service interface and is never sent to the browser. `apps/web` also requires
`CHAT_SERVICE_URL`, the private origin of `apps/chat` (`http://chat:3001` in Compose).
`CHAT_TOKEN_ENCRYPTION_SECRET` should be a separate stable secret; changing it makes existing
provider tokens unreadable. For backwards-compatible local rollout, the encryption secret falls
back to `BETTER_AUTH_SECRET` when omitted. Production should set both secrets explicitly. In production,
`CHAT_PUBLIC_URL` is `${APP_DOMAIN}/api/chat` and the Kick developer application webhook is
`${APP_DOMAIN}/api/chat/webhooks/kick`.

`CHAT_WEB_URL` falls back to `APP_DOMAIN`; `CHAT_PUBLIC_URL` falls back to its `/api/chat` path.
Their explicit values remain useful when local ports differ.

`GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET` belong only to Better Auth sign-in. YouTube chat requests
`youtube.force-ssl` using its separate `YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET` pair. Twitch
requests chat read/write and moderation scopes. Kick
requests user/channel read, event subscription, chat write, message moderation, and ban scopes.
Kick webhook signatures are verified over `message-id.timestamp.raw-body` with RSA-SHA256, stale
timestamps are rejected, and `Kick-Event-Message-Id` is the JetStream idempotency key.

## Moderation and broadcast

The normalized moderation commands are:

- delete message;
- timeout user (seconds in the domain; converted to provider units at the adapter seam);
- ban user;
- unban user.

YouTube unban requires the provider ban ID returned when the ban is created, so that mapping is
stored separately from the audit. Kick timeout seconds are rounded up to minutes. UI actions are
shown only when the connection granted the required scope.

The broadcast composer sends the same normalized text to every enabled source with
`send_message`. Read-only sources return `unsupported`; provider failures return `failed`; other
providers continue independently. The UI shows these partial results per source.

## OBS overlay

Rotating the overlay URL creates a random 256-bit token. PostgreSQL stores only its SHA-256 hash.
The public overlay page presents the token to an `apps/web` tRPC subscription. `apps/web` resolves
the owner and relays only that user's feed from `apps/chat`. Rotation invalidates the previous URL
immediately.

## Development and operations

`just dev-db-up` starts PostgreSQL and NATS. `just dev` starts the TypeScript web app and the Go
chat, donation, and video services. `just typecheck` and `just test` include the Go services. The
When an internal chat request, response, or stream event changes, update the Go handler together
with the `apps/web` adapter and shared Zod schemas, then verify both sides.

Production Compose runs NATS with JetStream storage and healthchecks the chat service. Caddy sends
all public traffic to `apps/web`; only the web container reaches chat port 3001. Scale chat
collectors independently through NATS, and scale web with the number of browser and overlay
streams. PostgreSQL remains the source of truth for account configuration and audit.
