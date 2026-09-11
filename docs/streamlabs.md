# Streamlabs donation integration

Research checked on 2026-09-10 against the Streamlabs v2 documentation and the
current Coldbrew DonationAlerts implementation.

> [GitHub issue #32](https://github.com/lebedev-nikita/coldbrew/issues/32) is
> empty and is titled “Donations: integration with donate.stream”. The user
> request names Streamlabs, which is a different provider. This document assumes
> the intended provider is Streamlabs (`streamlabs.com`); the issue title should
> be corrected before it is closed.

## API and OAuth contract

Use API v2 at `https://streamlabs.com/api/v2.0`. Streamlabs says v2 access
tokens must be sent as `Authorization: Bearer <access_token>` and may not be
passed in the query string. The old official demo still uses v1 and a query
parameter, so it must not be copied for API calls. See the
[v2 migration notes](https://dev.streamlabs.com/docs/getting-started) and the
[current access-token guide](https://dev.streamlabs.com/docs/obtain-an-access-token).

The authorization-code flow is:

1. Redirect the streamer to
   `GET https://streamlabs.com/api/v2.0/authorize` with:
   `response_type=code`, `client_id`, `redirect_uri`, the space-separated
   `scope=donations.read socket.token`, and a cryptographically random `state`.
   `state` is optional in the wire reference but explicitly exists for CSRF
   protection. The two requested scopes are the least-privilege scopes for
   donation history and a Socket API token. There is no separate `/user` scope
   in the published scope table. See
   [`/authorize`](https://dev.streamlabs.com/reference/authorize) and
   [Scopes](https://dev.streamlabs.com/docs/scopes).
2. Streamlabs redirects to `redirect_uri` with either `code` or an error. The
   code is one-use and expires after five minutes, so exchange it immediately.
   See [Connecting to an account](https://dev.streamlabs.com/docs/connecting-to-an-account).
3. Exchange it at `POST https://streamlabs.com/api/v2.0/token` with
   `grant_type=authorization_code`, `client_id`, `client_secret`,
   `redirect_uri`, and `code`. The documented success example contains
   `access_token`, `token_type: Bearer`, and `refresh_token`. See
   [`/token`](https://dev.streamlabs.com/reference/token-1).
4. Load `GET https://streamlabs.com/api/v2.0/user` with the access token in the
   `Authorization` header
   and retain `streamlabs.id` as the provider account identity. Its documented
   type is an integer; normalize it to a decimal string at the provider seam.
   See [`/user`](https://dev.streamlabs.com/reference/user).

The current `/token` documentation disagrees about request encoding: its
OpenAPI parameters and curl sample imply form/query fields, while the newer
access-token guide sends a JSON body. Both are first-party examples. Prefer the
JSON request shown in the current guide, keep token exchange isolated in the
provider client, and confirm it in the authenticated smoke test.

### Refresh behavior

The refresh request uses the same v2 token endpoint with
`grant_type=refresh_token`, `client_id`, `client_secret`, `redirect_uri`, and
`refresh_token`. Always persist the returned access and refresh tokens together
because the refresh token may rotate. The canonical endpoint remains
`https://streamlabs.com/api/v2.0/token`; the refresh example in the reference
incorrectly uses the legacy `www.twitchalerts.com` hostname. See
[`/token`](https://dev.streamlabs.com/reference/token-1).

Streamlabs' [OAuth guide](https://dev.streamlabs.com/docs/oauth-2) is internally
inconsistent: it says access tokens never expire, but then shows an expiry-based
refresh flow with `expires_in`; the `/token` response schema does not document
`expires_in`, and the same guide contains misspelled response keys. Coldbrew
should therefore retain refresh credentials but refresh only after an
authenticated API request returns 401, using the existing token-version
compare-and-swap pattern. It should not invent a scheduled expiry.

The Streamlabs flow should use and validate `state`. The existing
[DonationAlerts ownership ADR](adr/0004-donations-service-ownership.md) records
the absence of `state` there as a known login-CSRF risk; that compatibility gap
should not be copied into a new provider.

## Donation history

History is
`GET https://streamlabs.com/api/v2.0/donations` with the access token in the
`Authorization` header and
the `donations.read` scope. Results are ordered by creation time descending.
The documented payload is:

```json
{
  "data": [
    {
      "donation_id": "80179029",
      "created_at": "1438576556",
      "currency": "USD",
      "amount": "50",
      "name": "Thomas",
      "message": "nice!"
    }
  ]
}
```

The same official example shows `message: null` on another row even though the
OpenAPI property says `string`, so the decoder must accept a nullable message.
`donation_id`, `created_at`, and `amount` are documented as strings. See
[`GET /donations`](https://dev.streamlabs.com/reference/donations).

Map a REST row into Coldbrew as follows:

| Streamlabs    | Coldbrew           | Notes                                                                                                                                              |
| ------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `donation_id` | `sourceDonationId` | Preserve the decimal string; do not parse through a fixed-width integer.                                                                           |
| `name`        | `author`           | Preserve UTF-8 text.                                                                                                                               |
| `message`     | `message`          | Accept `null`.                                                                                                                                     |
| `amount`      | `amount`           | Normalize once with the shared money normalizer.                                                                                                   |
| `currency`    | `currency`         | Preserve the originating currency.                                                                                                                 |
| `created_at`  | `sourceCreatedAt`  | Preserve the exact source string.                                                                                                                  |
| `created_at`  | `occurredAt`       | The sample is Unix-seconds-shaped, but the unit and timezone are not formally specified; confirm with a real fixture before relying on that parse. |

Do not pass the optional `currency` parameter: Streamlabs describes it as the
desired output currency, while Coldbrew must store original money without
conversion. Omit `verified` as well so both verified payment donations and
donations added by the streamer on Streamlabs are imported. Streamlabs lists
the possible three-letter currencies separately in
[Currency Codes](https://dev.streamlabs.com/docs/currency-codes).

### Pagination

Pagination is cursor-based. `before=<donation_id>` returns older IDs,
`after=<donation_id>` returns newer IDs, and `limit` controls page size. The
official history example starts with `limit=50`, then passes the last
`donation_id` in that response as `before` to load the next older page. There is
no documented `next_cursor`, total, default limit, maximum limit, or explicit
end marker. See [Pagination](https://dev.streamlabs.com/docs/pagination).

For the initial import, use the documented `before` walk and stop on an empty
page (also tolerate a short page as a likely end, but an empty page is the only
unambiguous local stop). Persist each page idempotently under
`(user, streamlabs, source_donation_id)`. For later reconciliation, walk
backwards from the current head until a persisted checkpoint is encountered;
this avoids relying on the undocumented interaction of `after` and `before`
when more than one page arrived between checks. Bound the walk and surface an
error instead of silently truncating it.

## Realtime Socket API

Realtime delivery is Socket.IO, not a raw RFC 6455 WebSocket:

1. Fetch `GET https://streamlabs.com/api/v2.0/socket/token` using the OAuth
   access token in the `Authorization` header and the `socket.token` scope. The
   response is `{"socket_token":"..."}`. See
   [`/socket/token`](https://dev.streamlabs.com/reference/sockettoken).
2. Connect a Socket.IO client to
   `https://sockets.streamlabs.com?token=<socket_token>` and force the
   `websocket` transport. Streamlabs' sample loads Socket.IO client 2.0.3, so a
   generic WebSocket client cannot consume this endpoint without implementing
   Engine.IO and Socket.IO framing. See the
   [Socket API guide](https://dev.streamlabs.com/docs/socket-api).
3. Listen for the Socket.IO event named `event`. A donation envelope has
   `type: "donation"` and a `message` array. Handle every element; one envelope
   may contain more than one donation.

The documented donation event is shaped like this:

```json
{
  "type": "donation",
  "message": [
    {
      "id": 96164121,
      "name": "test",
      "amount": "13.37",
      "message": "test donation",
      "currency": "USD",
      "_id": "0820c9d5bafd768c9843f5e35c885e71"
    }
  ],
  "event_id": "evt_17e5f4dc6888767ed9799f78dfa2cabc"
}
```

Use `message[].id`, normalized from number or string to a decimal string, as the
candidate source donation ID. Do not use the envelope `event_id` or the opaque
`message[]._id`. The documentation does not explicitly guarantee that socket
`id` equals REST `donation_id`, so that equivalence must be verified with a real
donation before production.

The guide also contradicts itself about `for`: its JavaScript detects a
donation only when `for` is absent, while its event table says donation events
have `for = streamlabs`. Accept `type = donation` when `for` is absent or equals
`streamlabs`, and reject other provider namespaces.

The socket payload omits `created_at`. Treating the socket as a wake-up signal
and reconciling `/donations` immediately gives Coldbrew the authoritative REST
shape, catches any events missed during a disconnect, and avoids inventing a
source timestamp. Debounce a burst of socket envelopes into one reconciliation
request. Keep the existing periodic history reconciliation as a backstop.

### Reconnection and delivery guarantees

Streamlabs does not document socket-token lifetime, disconnect reasons,
backoff, replay, acknowledgements, or any delivery guarantee. Its sample relies
on the Socket.IO client's reconnect behavior without configuring it. Socket.IO
clients reconnect automatically, but default server-to-client delivery is at
most once: the server does not buffer events for a disconnected client. See
Socket.IO's first-party [client options](https://socket.io/docs/v4/client-options/#reconnection)
and [delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/).

Consequently, reconnect with bounded exponential backoff and jitter, obtain a
fresh socket token for each new outer session, and run a REST reconciliation
after the initial socket connection and every reconnect. A successful
reconnection is not evidence that no donation was missed. Streamlabs' sample
uses Socket.IO 2.0.3, while Socket.IO state recovery is a newer, server-enabled
feature; Streamlabs does not claim to enable it, so it cannot replace history
reconciliation. See Socket.IO's
[connection-state recovery contract](https://socket.io/docs/v4/connection-state-recovery/).

An unauthenticated protocol probe on 2026-09-10 observed that the current
Streamlabs endpoint accepted Engine.IO 2, 3, and 4 opening handshakes; an
Engine.IO 4 namespace connection with a dummy token returned
`Authentication error`. This is an observation, not a published compatibility
promise. Pin a known-compatible Socket.IO client and cover the handshake with
an authenticated smoke test.

## Coldbrew lifecycle relative to DonationAlerts

The existing DonationAlerts lifecycle remains the right high-level shape:
OAuth starts in the authenticated web app, while the donations service owns
code exchange, provider identity, initial history import, token refresh,
realtime collection, reconciliation, and persistence. Connect should report
success only after identity and the complete initial history are stored
atomically. Reconnects should replace listeners through `token_version`, and a
failed stale refresh must not overwrite a newer connection. See
[ADR 0004](adr/0004-donations-service-ownership.md) and the current
[`internal/donations` module](../internal/donations/application.go).

Streamlabs-specific differences are:

- OAuth endpoints and the minimal scopes are provider-specific.
- `streamlabs.id` is the external account identity.
- History uses cursor pagination instead of DonationAlerts page metadata.
- Socket.IO framing and a separately fetched socket token replace the
  DonationAlerts Centrifugo subscription handshake.
- The socket event is not a complete immutable donation record because it has
  no source creation time; REST reconciliation should be authoritative.
- Streamlabs gives no dependable expiry schedule, so refresh is 401-driven.

The implementation adds `streamlabs` to the donation-source enum and stores its
credentials and history checkpoint in `streamlabs_connection`. The migration is
tracked in `db/migrations/20260910180000_streamlabs.sql`; deployment applies it
before starting the new application image.

## Streamlabs application setup

1. Sign in and create an OAuth client from the
   [Streamlabs registration page](https://streamlabs.com/login?r=https://streamlabs.com/dashboard#/oauth-clients/register),
   following the [registration guide](https://dev.streamlabs.com/docs/register-your-application).
2. Register the production callback
   `https://<domain>/api/integration/streamlabs/callback`. Send exactly that same
   absolute URI in both `/authorize` and `/token`. Public docs do not state
   redirect exact-match or HTTPS rules, so using one exact HTTPS value is the
   safe setup.
3. While the application is not approved, add each test streamer to its
   whitelist. Streamlabs allows at most ten whitelist users for an unapproved
   application.
4. Request only `donations.read socket.token` in the authorization URL.
5. Put the issued client ID in `STREAMLABS_CLIENT_ID` and the client secret in
   `STREAMLABS_CLIENT_SECRET`. The OAuth flow obtains each streamer's access,
   refresh, and socket tokens; those are not deployment inputs.
6. Before opening the integration to arbitrary users, submit the application
   for review. Streamlabs asks for step-by-step usage instructions and at least
   three screenshots. See
   [Submit your application](https://dev.streamlabs.com/docs/submit-your-application).

The published tier table allows five attempts per minute for `TESTING` and
2,400 per minute for `APPROVED`, but does not define whether the bucket is per
application, account, token, IP, or endpoint. See
[Tiers](https://dev.streamlabs.com/docs/tiers). Initial history pagination and
event-triggered reconciliation must therefore pace 429 responses and honor a
provider retry hint if one is returned.

## Credentialed verification still required

The following facts cannot be settled from the public documentation and should
be checked once the Streamlabs client credentials are available:

- accepted `/token` content type and the exact 401/error response shape;
- whether token refresh rotates the refresh token and whether any expiry value
  is actually returned;
- whether `/user` works with only `donations.read socket.token`;
- the real type and semantics of `created_at`;
- the maximum/default history limit and end-of-pagination behavior;
- whether socket `message[].id` exactly matches REST `donation_id`, whether
  `for` is absent or `streamlabs`, and whether all event elements appear in
  REST immediately;
- socket-token lifetime, Socket.IO protocol compatibility, authentication
  failure behavior, and reconnect behavior;
- 429 headers and the scope of the documented request bucket.

An authenticated smoke test should connect a whitelisted streamer, import
history, receive one real test donation on the socket, match it to REST, force a
disconnect and reconcile the gap, exercise refresh after a controlled 401 if
possible, and finally verify disconnect/revocation. No production token should
be recorded in fixtures or logs.
