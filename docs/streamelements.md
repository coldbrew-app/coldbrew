# StreamElements donation integration

Research checked on 2026-09-15 against the current StreamElements OAuth, Kappa API, Astro WebSocket,
and developer-dashboard contracts.

## OAuth contract

StreamBrew uses a confidential OAuth application and the authorization-code flow documented in
[StreamElements OAuth2](https://github.com/StreamElements/api-docs/blob/main/docs/OAuth2.md):

1. Redirect the authenticated streamer to `https://api.streamelements.com/oauth2/authorize` with
   `response_type=code`, the exact callback URI, `channel:read tips:read`, and a cryptographically
   random `state`.
2. Store `state` in a provider-specific signed, HttpOnly, SameSite cookie and consume that cookie in
   the callback. A Streamlabs state cookie is deliberately not interchangeable with it.
3. Exchange the one-use code at `POST https://api.streamelements.com/oauth2/token` using an
   `application/x-www-form-urlencoded` body containing the client ID, client secret, code, callback,
   and `grant_type=authorization_code`.
4. Load `GET https://api.streamelements.com/kappa/v2/channels/me` with
   `Authorization: OAuth <access-token>` and retain `_id` as the source account and Astro room ID.

The documented refresh flow uses the same token endpoint with `grant_type=refresh_token`. A refresh
token may rotate, so StreamBrew saves the new access and refresh tokens together through the
existing token-version compare-and-swap lifecycle. An unauthorized API or Astro subscription
response triggers one refresh attempt. If the rotated token is rejected before a subscription is
confirmed, or the refresh grant itself is rejected, only that connection is moved to
`reauthorization_required`; the integrations page asks the streamer to connect it again. A later
expiry after a confirmed subscription is allowed its own refresh attempt. Permanent protocol and
request failures move the connection to `error` instead of starting an invisible retry loop.

StreamElements requires PKCE for public clients. Its public contract does not document combining a
confidential client secret with `code_verifier`, so StreamBrew uses the documented confidential flow
plus `state`. Do not switch the registered application to a public client without adding and testing
S256 PKCE end to end.

## Donation history

History is `GET https://api.streamelements.com/kappa/v2/tips/{channel}` with the OAuth header. Requests
use `limit=100`, an increasing `offset`, `sort=-createdAt`, `tz=0`, and one fixed `before` timestamp
for the complete traversal. Freezing the upper bound prevents newly arriving tips from shifting
offsets while the walk is in progress.

StreamElements currently has two response variants. The dashboard response exposes `totalDocs`,
`totalPages`, and `hasNextPage`; the older
[official OpenAPI contract](https://github.com/StreamElements/api-docs/blob/main/api.yaml#L16893)
uses `total`, `limit`, and `offset`. The client accepts both, also stops on an empty or short page,
and fails rather than silently truncating if the safety page limit is reached. Recent recovery adds
the documented `after` boundary and deliberately continues beyond the saved head tip ID, so a tip
that appears late or moves across an offset page is still seen inside the alert freshness window.
The hourly audit replays all available history because StreamElements exposes neither an immutable
cursor nor a stable secondary sort for discovering an arbitrarily backdated tip. The saved head ID
is advisory rather than a correctness boundary. PostgreSQL remains the final idempotency boundary
through `(user_id, source, source_donation_id)`, so a replay creates neither a duplicate donation nor
a second alert or video scan.

Map each tip as follows:

| StreamElements           | StreamBrew         | Notes                                                        |
| ------------------------ | ------------------ | ------------------------------------------------------------ |
| `_id`                    | `sourceDonationId` | Preserve the source string.                                  |
| `donation.user.username` | `author`           | Accept `null`.                                               |
| `donation.message`       | `message`          | Accept `null` and an empty string.                           |
| `donation.amount`        | `amount`           | Decode losslessly, then normalize once at the source seam.   |
| `donation.currency`      | `currency`         | Uppercase a valid three-letter original currency code.       |
| `createdAt`              | `sourceCreatedAt`  | Preserve the exact source string.                            |
| parsed `createdAt`       | `occurredAt`       | Parse RFC 3339 with fractional seconds and normalize to UTC. |

Do not filter history or live events by `status`, `approved`, or `deleted`. StreamElements does not
offer those as history filters, its dashboard reuses the fields during moderation, and the current
`channel.tips` contract already defines its messages as completed tips.

## Astro realtime delivery

The current realtime mechanism is the raw Astro WebSocket at
`wss://astro.streamelements.com/`, not the legacy Socket.IO endpoint. After `welcome`, subscribe with:

```json
{
  "type": "subscribe",
  "nonce": "<random nonce>",
  "data": {
    "topic": "channel.tips",
    "room": "<channel id>",
    "token": "<OAuth access token>",
    "token_type": "oauth2"
  }
}
```

The listener accepts the subscription only after a successful response with the matching nonce and
uses the canonical room returned in that response. A `channel.tips` message maps its `data` object
through the same validation as history; the outer WebSocket message ID and payment transaction ID
are not donation IDs. See the [Astro protocol](https://docs.streamelements.com/websockets) and
[`channel.tips` payload](https://docs.streamelements.com/websockets/topics/channel-tips).

The WebSocket library answers server ping frames while reads remain active. A graceful Astro drain
provides a reconnect token; reconnecting with it restores the subscription. Other disconnects use
bounded exponential backoff with jitter and a fresh subscription. Dial, `welcome`, and subscription
acknowledgement share a 15-second establishment deadline. A reconnect token received before the
subscription acknowledgement does not falsely mark the next session subscribed. Unauthorized
subscription errors return to the bounded token-refresh lifecycle. Permanent client/protocol errors
stop and become visible in the integrations page. Astro does not promise replay, so periodic REST
reconciliation remains the delivery-gap backstop.

Initial history is persisted atomically with the connection and never creates incoming donation
alerts. Valid live events are persisted immediately and create alerts when the user's alert settings
allow that source. Recovery history remains idempotent and can create an alert only inside the shared
freshness window.

## StreamElements application setup

1. Sign in as the owner and open the currently preview-gated
   [developer dashboard](https://streamelements.com/dashboard/account/developer?developer=1).
2. Register **StreamBrew** as a confidential application (`Public client` off) with website
   `https://streambrew.app` and exact callback
   `https://streambrew.app/api/integration/streamelements/callback`.
3. Put the client ID in the GitHub `production` environment variable
   `STREAMELEMENTS_CLIENT_ID` and the secret in the `STREAMELEMENTS_CLIENT_SECRET` environment
   secret. Do not use a channel JWT as the multi-user production credential.
4. Request only `channel:read tips:read` in StreamBrew's authorization URL.

New applications are issued credentials in `pending` state, but the current dashboard says staff
must approve them before they can request access from streamers. There is no documented owner test
bypass. Once the application is active, perform a credentialed smoke test: connect the owner,
confirm history import, receive one real or provider-generated test tip through Astro, force a
disconnect and verify REST recovery, then disconnect the integration. Never record tokens in logs or
fixtures.
