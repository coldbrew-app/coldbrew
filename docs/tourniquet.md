# Tourniquet donation integration

Research was checked on 2026-09-15 against Tourniquet's authenticated widget
pages, the JavaScript bundle shipped by Tourniquet, and a disposable-account
smoke test. No test-account credentials or widget tokens are retained in this
repository.

## Available integration surface

[Tourniquet](https://tourniquet.app/) exposes donation alerts as browser widgets.
Its authenticated [API page](https://tourniquet.app/docs) currently says that
API access is available only to a limited number of users, so an ordinary
StreamBrew user cannot complete a documented OAuth or API-token flow. The
integration therefore follows the realtime protocol used by Tourniquet's own
alert widget rather than depending on a private API.

This is deliberately a live-only integration. The public widget protocol only
subscribes to realtime events, and no donation-history endpoint is documented
for an ordinary account. It follows that StreamBrew cannot import donations
created before connection or recover events missed while StreamBrew,
Tourniquet, or Pusher is unavailable. Reconnects resume new events; they do not
backfill the gap. This limitation is an inference from the restricted
[API page](https://tourniquet.app/docs) and the realtime-only implementation in
Tourniquet's [shipped application bundle](https://tourniquet.app/build/assets/app-5e4c1750.js).

## Connecting and disconnecting

1. Sign in to Tourniquet and open [Profile → Widgets](https://tourniquet.app/profile/widgets).
2. Copy the full **Your donation alert link**. Tourniquet renders it in this
   form:

   ```text
   https://tourniquet.app/widgets/alert/<widget-token>
   ```

3. Paste the link into the Tourniquet card on StreamBrew's **Integrations**
   page. StreamBrew accepts only HTTPS URLs on `tourniquet.app` with exactly the
   `/widgets/alert/<widget-token>` path and no user info, port, query, or
   fragment.
4. StreamBrew extracts and stores the token on the donations-service side and
   starts the listener. Connecting again replaces the saved token and fences
   the old listener so it cannot persist a late event.

The token selects the account-specific event on a public Pusher channel. A
public subscription needs no authorization, so neither Pusher nor the widget
route can prove that a syntactically valid token belongs to the current user;
an incorrect token remains silent rather than returning an authentication
error. This follows from the event binding in Tourniquet's
[bundle](https://tourniquet.app/build/assets/app-5e4c1750.js) and Pusher's
[public-channel protocol](https://pusher.com/docs/channels/library_auth_reference/pusher-websockets-protocol/).
The StreamBrew form therefore validates the URL shape, not remote ownership.

Disconnecting deletes the saved connection and stops its listener. It does not
delete already accepted donations, videos, or donation alert playbacks.

## Realtime transport

Tourniquet's own bundle loads Pusher Channels JavaScript 8.0.1 and creates a
client with the following identifiers:

| Part                   | Value                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| Pusher application key | `6c6973024a68ab77f121`                                                                           |
| Cluster                | `eu`                                                                                             |
| WebSocket URL          | `wss://ws-eu.pusher.com/app/6c6973024a68ab77f121?protocol=7&client=js&version=8.0.1&flash=false` |
| Channel                | `donation_channel`                                                                               |
| Paid event             | `donation-paid<widget-token>`                                                                    |

The key, cluster, channel, and event construction are visible in
Tourniquet's [shipped application bundle](https://tourniquet.app/build/assets/app-5e4c1750.js).
The URL is the corresponding TLS endpoint produced for that cluster and key;
the frame formats are defined by the official
[Pusher Channels protocol](https://pusher.com/docs/channels/library_auth_reference/pusher-websockets-protocol/).

After `pusher:connection_established`, StreamBrew sends:

```json
{
  "event": "pusher:subscribe",
  "data": { "auth": "", "channel": "donation_channel" }
}
```

Pusher channel-event `data` is a JSON-encoded string, so it is decoded once
before the Tourniquet payload. StreamBrew responds to `pusher:ping` with
`pusher:pong`, reconnects with bounded exponential backoff after transport
failure, and resubscribes after every reconnect. These connection, subscription,
double-encoding, and heartbeat rules come from the
[Pusher Channels protocol](https://pusher.com/docs/channels/library_auth_reference/pusher-websockets-protocol/).

## Paid event mapping

Tourniquet's donation list and alert widget consume these paid-event fields in
the [current bundle](https://tourniquet.app/build/assets/app-5e4c1750.js):

| Tourniquet field         | StreamBrew field       | Handling                                                                                                             |
| ------------------------ | ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `order_id`               | `sourceDonationId`     | Required. Preserve a string value; normalize a numeric JSON scalar without passing it through a fixed-width integer. |
| `username`               | `author`               | Preserve the donor name; accept an absent or null value.                                                             |
| `text`                   | `message`              | Preserve the message; accept an absent or null value.                                                                |
| `updated_at`             | `sourceCreatedAt`      | Preserve Tourniquet's exact source text.                                                                             |
| `updated_at`             | `occurredAt`           | Parse the `YYYY-MM-DD HH:mm:ss` value as UTC, matching Tourniquet's own donation-list conversion.                    |
| `amount`                 | original fiat amount   | Normalize the decimal value when no crypto amount is present.                                                        |
| `fiat`                   | original fiat currency | Trim and uppercase the provider value when no crypto amount is present.                                              |
| `price_in_token_rounded` | original crypto amount | When present with `money_type`, preserve this decimal amount instead of the fiat quote.                              |
| `money_type`             | original crypto asset  | Preserve the trimmed, uppercased full label, including the network qualifier, for example `USDT (TRX)`.              |

Tourniquet's widget replaces `amount`/`fiat` with
`price_in_token_rounded`/`money_type` when the crypto field is present. From
that first-party behavior, StreamBrew infers that the latter pair represents
the original transferred asset and amount, while the former pair is its fiat
quote. Keeping the complete `money_type` avoids collapsing assets on different
networks; the bundle currently distinguishes values including `USDT (BNB)`,
`USDT (TRX)`, `USDT (ETH)`, `DAI (ETH)`, and `USDC (ETH)`.

The original `{ amount, currency }` on `donation` is immutable. It is never
overwritten by queue conversion. Crypto assets are not queue currencies in the
initial StreamBrew rate table, so a video created from such a donation keeps
the original donation amount but may have a null `queue_amount`; see
[Currencies and video queues](currencies.md).

### Tourniquet test alerts

The authenticated [Widgets page](https://tourniquet.app/profile/widgets)
provides a button that sends an alert for testing the Tourniquet browser widget.
In the 2026-09-15 smoke test, that event contained `username`, `amount`, `fiat`,
and `alert_volume`, but no `order_id` or `updated_at`. The real paid-event path
in Tourniquet's [bundle](https://tourniquet.app/build/assets/app-5e4c1750.js)
expects both fields for transaction identity and time.

StreamBrew ignores any event without `order_id`. A widget test is presentation
data, not an immutable support event, and inventing a transaction ID or time
would create a synthetic donation, break source idempotency, and potentially
enqueue a false alert or video. Ignoring it must not tear down the listener or
delay later paid events.

## Persistence and downstream behavior

Every paid event is inserted with source `tourniquet`. The existing unique key
on `(user_id, source, source_donation_id)` and `INSERT ... ON CONFLICT DO
NOTHING` make redelivery of the same `order_id` idempotent. Only the first
insert can create an automatic donation alert playback.

Because this source has no history or recovery API, every accepted Tourniquet
payment is a live donation. It participates in the same source-enabled and
freshness checks, transaction, TTS preparation, and OBS playback queue as the
other integrations; see [Donation alerts](donation-alerts.md). An ignored test
event and a duplicate paid event create neither a donation nor a playback.

Inserting a Tourniquet donation also uses the existing PostgreSQL trigger to
create a `donation_video_scan` row. The video worker scans its message for
supported YouTube links, persists each video idempotently, and fetches metadata
through the normal retry queue; see
[ADR 0005](adr/0005-donation-video-handoff.md) and
[Video metadata](video-metadata.md). The integration does not create a
synthetic donation for a video and does not change the original donation money.

## Token security and operations

Treat the Tourniquet widget link as a credential: possession of its path token
is sufficient to select the streamer's paid-event name on the public channel.
StreamBrew must not return the token in `UserInfo`, tRPC responses, logs, error
messages, telemetry, or documentation. Store it only in the private connection
table needed by the donations worker. UI state exposes only whether a
Tourniquet connection exists.

The listener must also reject frames for another channel or event, cap frame
size through the WebSocket implementation, and report bounded error categories
without including raw payloads. Operators should diagnose a silent source by
checking connection state and listener errors first; the Tourniquet test button
cannot verify donation persistence because its event is intentionally ignored.

## Deployment

The integration requires a forward database migration for the `tourniquet`
donation-source enum value, its private connection table, and sufficient
original donation/alert amount and asset capacity for Tourniquet crypto values.
Deploy the matching web and donations-service revisions together. Following
the repository's [release procedure](deployment.md#releases-and-migrations), a
revision containing this migration stops before production deployment until an
operator reviews it and reruns the **Production** workflow for the same
revision with `apply_migrations=true`.

After deployment:

1. Connect a disposable Tourniquet account with its full widget link.
2. Confirm that the Tourniquet test button creates no StreamBrew donation.
3. Send one real low-value payment containing a supported YouTube URL.
4. Verify one `tourniquet` donation with the exact transaction reference,
   source time, author, message, and original asset amount.
5. Redeliver the same paid-event fixture and verify that neither the donation
   nor its incoming alert duplicates.
6. Verify that the OBS widget shows the incoming alert and that the YouTube
   video reaches its assigned video queue, or retains a null `queue_amount`
   when the crypto asset has no configured conversion rate.
7. Disconnect Tourniquet and verify that subsequent events are not accepted
   while existing donations, videos, and playbacks remain intact.
