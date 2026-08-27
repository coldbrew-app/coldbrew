# Multichat

The authenticated `/chat` page combines ordinary public YouTube chat messages. Streamers configure up to eight live-stream URLs without authorizing Coldbrew with YouTube.

Messages are transient. The web process keeps at most 200 messages per active source in memory and never stores chat history in PostgreSQL. Collectors are shared by canonical source identifier and remain alive for 90 seconds after their last viewer disconnects.

Raw source URLs are parsed once at the input seam into canonical `ChatSource` values. The editor, tRPC procedure, persistence, and collector registry exchange those values rather than raw URLs; duplicate detection and collector ownership use the shared canonical source key.

Provider adapters expose `ResultStream<ChatStreamEvent, ChatProviderError>`, an alias for `AsyncIterable<Result<T, E>>`; the process-local registry exposes the same shape with `ChatRegistryError`. `createResultEventStream`, `fromFallibleAsyncIterator`, and `mergeResultStreams` contain the callback, iterator, cancellation, and fan-in mechanics shared by the providers. Expected failures from event iterators, sockets, gRPC, generated clients, and foreign payloads are converted to `Result` at their nearest external-service seam. SQL failures and internal tRPC/Zod invariant failures remain fail-fast. The tRPC subscription unwraps successful registry events and converts typed registry failures to a public `connection_error` event with a stable code and safe message.

Foreign-service mechanics live in deep `@coldbrew/packages` modules. Each module owns its callbacks, transport, retries, cancellation, and mutable runtime resources, then exposes a narrow asynchronous iterator of normalized Result events. Callback APIs remain private adapters at third-party boundaries and do not leak into business logic. The YouTube client owns Data API lookup, gRPC transport, protobuf wire types, pagination, retry, and cancellation. DonationAlerts REST calls use `safeFetch`, JSON validation, and structured HTTP status handling; its SDK remains only at the WebSocket boundary. Twitch separates Helix/OAuth calls (`twitch-chat-api`), EventSub decoding and socket ownership (`twitch-eventsub`), and subscription/channel orchestration (`twitch-chat`). The small adapters under `apps/web/src/server/chat` add Coldbrew provider identifiers, map messages into `ChatMessage`, and choose user-safe error text.

An error for one source becomes its `state: "error"` event, so other sources can continue. Session-wide failures emit `connection_error` and then close normally. Public live-stream interfaces accept an optional parent `AbortSignal`; every returned iterator owns an internal cancellation scope and aborts nested work before `.return()` completes. Cancellation is normal completion and never emits an error. The process-local collector pool owns shared collectors, replay buffers, subscriber counts, and grace-period shutdown; the registry owns only per-session limits and stream merging. Runtime resources remain in explicit mutable maps, while collector snapshots, retries, credentials, source state, and client state are replaced through pure reducers. WebSocket, tRPC, and React callbacks are limited to adapters that dispatch into these streams or reducers.

## OBS overlay

Rotating the overlay URL creates a random 256-bit token. PostgreSQL stores only its SHA-256 hash, so the raw URL is shown once and cannot be recovered. Rotation invalidates the previous URL immediately. `/chat/overlay/$token` is public, feed-only, and does not depend on browser cookies or a Coldbrew session.

## YouTube integration

The web process requires `YOUTUBE_API_KEY`. It uses the YouTube Data API v3 `videos.list` endpoint to find the active live chat, then reads messages through the low-latency gRPC `streamList` endpoint.

The checked-in `packages/src/youtube-live-chat/proto/stream_list.proto` comes from the official YouTube Streaming Live Chat documentation. Run `just generate-youtube-chat-proto` after updating it. Generated TypeScript is committed beside the package client so production builds do not need `protoc`.

Only ordinary text messages are displayed. System events are ignored individually and do not cause other messages from the same response to be discarded.

## Twitch status

Twitch is temporarily disabled. Its API client, thin web adapter, URL canonicalizer, and database enum value remain isolated for a later return, but the active URL parser and collector registry contain only YouTube. Existing Twitch sources are hidden and are deleted the next time their owner saves the source list.

Provider availability is decided at the composition seam: the active source parser and provider registry. Keeping a provider out of those registries disables it without conditional checks spread across transport, UI, and business logic.

When restored, one client owns one shared EventSub WebSocket and fans messages out by broadcaster. It follows Twitch reconnect URLs without opening a parallel steady-state connection and accepts at most 300 active or pending subscriptions on that socket. EventSub revocations are routed back to the affected channel as typed subscription failures.

To re-enable Twitch, restore the `TWITCH_CHAT_*` environment schema, construct `createTwitchChatClient` from those credentials, wrap it with `createTwitchChatProvider`, register the resulting adapter and `parseTwitchChatSource`, and restore Twitch product copy.

The current collector registry is process-local. Run a single web process until collector ownership and fan-out are moved to shared infrastructure.
