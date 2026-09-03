# ADR 0002: Web-owned chat interface

- Status: accepted
- Date: 2026-09-03
- Supersedes: the direct browser-to-chat interface in ADR 0001

## Context

Direct browser access to `apps/chat` made Caddy, the browser, and the Go process share one public
interface. The browser needed a second tRPC client, short-lived chat tickets, and a static
TypeScript router description for procedures implemented manually in Go. Runtime responses and
stream events crossed that seam without Zod validation in `apps/web`.

## Decision

`apps/web` owns the public chat tRPC interface. It authenticates editor procedures with the normal
Coldbrew session, validates every procedure input and every value returned by `apps/chat` with
Zod, and relays validated subscriptions to the browser.

`apps/chat` keeps provider credentials, collectors, commands, OAuth state, and webhook processing.
It exposes an internal JSON/NDJSON interface authenticated with `CHAT_SERVICE_SECRET`; callers
cannot choose a user without possessing that service credential. OAuth callbacks and the Kick
webhook retain their public `/api/chat` URLs, but an allowlisted route in `apps/web` is their only
public entry point.

## Consequences

- The browser has one tRPC client and one authentication model.
- Caddy proxies only to `apps/web`; `apps/chat` is private to the Compose network.
- Zod schemas at the web-to-chat seam detect incompatible Go responses before they reach UI code.
- `apps/web` relays live events, so its streaming capacity now scales with connected editors and
  overlays.
