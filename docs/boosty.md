# Boosty multichat

Boosty is a read-only provider using an unofficial Go HTTP client in
`internal/chat/provider_boosty.go`. It follows the web client's stream-chat
endpoints. It does not collect private dialogs or post comments.

## Connect

1. Create a separate browser profile without browser sync for Coldbrew. Sign in
   to your own account at `https://boosty.to` in that profile. Do not copy credentials
   from the browser profile you use to watch or manage Boosty.
2. Open browser developer tools → Application. Find the `auth` entry in Cookies
   or Local Storage for Boosty.
3. Copy its entire URL-encoded value into the `auth` field. Coldbrew decodes it and
   extracts `accessToken`, `refreshToken`, and the absolute millisecond `expiresAt` automatically. Copy `_clientId` from Cookies
   or Local Storage in the same browser into the `_clientId` field.
4. Close all Boosty tabs in the separate profile **without signing out**. Do not
   reopen Boosty in that profile while Coldbrew owns the session. Continue using
   Boosty in your usual profile.
5. In Coldbrew → Multichat → Boosty, confirm that you used a separate session,
   fill the two fields, and select **Connect Boosty**.

Coldbrew resolves `/v1/user/current`, derives the blog from that identity, and
checks its owner through `/v1/blog/{blog}`. An arbitrary viewer-supplied channel
URL is not accepted. Account credentials are encrypted by the existing chat
credential store and never included in configuration or OBS events. Reconnecting
updates the existing connection and restarts its collector through `token_version`.

Access and refresh tokens are encrypted by the existing credential store; the device ID
is stored in `oauth_device_id`. The shared token refresher exchanges the refresh token
with `POST https://api.boosty.to/oauth/token/`, using a form containing `grant_type`,
`refresh_token`, `device_id`, and `device_os=web`. No client ID or secret is sent.
The response's `expires_in` determines the expiry; access and rotated refresh tokens
are saved together using `token_version` compare-and-swap. The refreshed identity must
still match the connected blog.

The imported expiry is saved with the connection, so a valid token is not refreshed
on the first collector start. Collection renews one minute before expiry through
the shared collector lifecycle. Calls that omit expiry retain the unknown-expiry
refresh behavior; refresh credentials are accepted only with `dedicatedSession: true`. Temporary refresh failures retry with backoff; rejected sessions require
reconnection. Existing access-token-only connections still work until their token
expires and must be reconnected once with a refresh token and device ID to enable
renewal. No Boosty OAuth application or environment credentials are needed; the previously reserved `BOOSTY_CLIENT_ID` and
`BOOSTY_CLIENT_SECRET` settings do not configure this connection.

## Browser session ownership

A copied auth value is a copy of a browser session, not a new authorization grant.
Boosty's web client exchanges `refresh_token` together with `device_id` and saves
both returned tokens in its own auth storage. Coldbrew saves its rotated pair only
in its database. Sharing that session lets the website and collector invalidate
each other's credentials. A generated replacement `_clientId` alone does not
establish a separately authenticated session.

The original connection flow also discarded `expiresAt`, forcing an immediate
rotation. The import regression test exercises connection persistence followed by
collector refresh and asserts that a still-valid token is not exchanged.

Connections imported from a normal browser before this fix must be reconnected
using a separate session. Already revoked credentials cannot be repaired locally.
The confirmation is the user's declaration of session ownership; the unofficial
API does not let Coldbrew verify that no browser still uses those credentials.

## Collection

- Discover the stream using `GET /v1/blog/{blog}/video_stream`.
- Read messages with `GET /v1/blog/{blog}/video_stream/chat?limit=100`.
- Follow `extra.offset` backwards until reaching the previous message or timestamp,
  then publish new messages in chronological order through the existing NATS lease
  and event-deduplication pipeline.
- Skip historical messages on the first successful collection. Poll every five
  seconds while live and every thirty seconds while offline. A 204, 404, or a
  stream with `isOnline: false` means offline. Transport and rate-limit errors use
  exponential backoff up to one minute.
- Bound catch-up to twenty pages per poll. Invalid responses, repeated cursors,
  and overflow produce a visible source error instead of silent truncation.
- Normalize text/link content blocks and rich-text tuples to plain text. Skip
  system messages and unsupported content blocks. Do not expose Boosty payloads
  directly to the browser.

Sending, moderation, attachments, and propagation of messages deleted on Boosty
are not supported. Collection uses HTTP polling rather than WebSocket delivery.
The internal API can change without notice.

## Protocol evidence and verification

Inspected on 2026-09-06:

- [beekamai/boosty-api](https://github.com/beekamai/boosty-api): authenticated user,
  blog identity, and Bearer authorization contracts. Its messaging resource
  implements private dialogs; it does not implement stream chat.
- [an1by/boosty-js](https://github.com/an1by/boosty-js): also does not implement
  stream-chat collection. Neither SDK is added as a runtime dependency.
- Boosty's public web client: `app.Diem8kc9.js` and `index.CCIdS0WE.js` served by
  `https://static.boosty.to/js/`. These define stream discovery, chat pagination,
  `author`, `createdAt`, and rich-text content fields. The adapter is independently
  implemented from these protocol observations.
- A public `/v1/blog/boosty` request confirmed blog and owner identity fields.

Automated tests use local HTTP fixtures derived from these contracts. They verify
ownership, token validation, refresh rotation and expiry, read-only capabilities, history suppression,
pagination, message normalization, error handling, and cancellation. Authenticated
collection from a real live stream still requires a streamer session for an
end-to-end smoke test; fixtures are not captured live-chat traffic.

Authenticated smoke test on 2026-09-08 used a fresh Google sign-in in an isolated
Chrome Incognito session. After closing all windows of that session without
signing out, the real credentials were imported through the Coldbrew form.
PostgreSQL retained the imported expiry and token version 1; the collector reported
offline without an authorization error. Advancing the local connection expiry and
version triggered the production refresher against Boosty's real API. It persisted
the renewed credentials and a new 30-day expiry, and collection resumed offline.
Reloading Boosty in the normal browser profile retained its signed-in owner controls.
No stream was live during this check, so live-message delivery remains unverified.
