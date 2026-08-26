# Multichat

The authenticated `/chat` page combines ordinary public YouTube and Twitch chat messages. Streamers configure up to eight live-stream or channel URLs; they do not authorize Coldbrew with either platform.

Messages are transient. The web process keeps at most 200 messages per active source in memory and never stores chat history in PostgreSQL. Collectors are shared by canonical source identifier and remain alive for 90 seconds after their last viewer disconnects.

## OBS overlay

Rotating the overlay URL creates a random 256-bit token. PostgreSQL stores only its SHA-256 hash, so the raw URL is shown once and cannot be recovered. Rotation invalidates the previous URL immediately. `/chat/overlay/$token` is public, feed-only, and does not depend on browser cookies or a Coldbrew session.

## Service credentials

The web process accepts these optional variables. Missing credentials leave the corresponding source in an error state without preventing the application from starting.

- `YOUTUBE_API_KEY`: YouTube Data API v3 key used by `videos.list` and Live Chat gRPC `streamList`.
- `TWITCH_CHAT_CLIENT_ID`: Twitch application client ID.
- `TWITCH_CHAT_ACCESS_TOKEN`: service-user token with `user:read:chat`.
- `TWITCH_CHAT_USER_ID`: service-user ID; token validation refreshes this value in memory.
- `TWITCH_CHAT_CLIENT_SECRET` and `TWITCH_CHAT_REFRESH_TOKEN`: optional refresh credentials.

The current collector registry is process-local. Run a single web process until collector ownership and fan-out are moved to shared infrastructure.
