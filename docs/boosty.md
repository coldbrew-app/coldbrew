# Boosty multichat

Boosty is a read-only provider using an unofficial Go HTTP client in
`internal/chat/provider_boosty.go`. It follows the web client's stream-chat
endpoints. It does not collect private dialogs or post comments.

## Connect

1. Sign in to your own account at `https://boosty.to`.
2. Open browser developer tools → Application. Find the `auth` entry in Cookies
   or Local Storage for Boosty.
3. Copy its entire URL-encoded value into the `auth` field. Coldbrew decodes it and
   extracts `accessToken` and `refreshToken` automatically. Copy `_clientId` from Cookies
   or Local Storage in the same browser into the `_clientId` field.
4. In Coldbrew → Multichat → Boosty, fill the two fields and select **Connect Boosty**.

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

On the first collector start, the expiry is unknown, so the service refreshes once.
Subsequent collection renews one minute before expiry through the shared collector
lifecycle. Temporary refresh failures retry with backoff; rejected sessions require
reconnection. Existing access-token-only connections still work until their token
expires and must be reconnected once with a refresh token and device ID to enable
renewal. No Boosty OAuth application or environment credentials are needed; the previously reserved `BOOSTY_CLIENT_ID` and
`BOOSTY_CLIENT_SECRET` settings do not configure this connection.

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
