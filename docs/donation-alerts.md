# Donation alerts

StreamBrew can turn newly accepted donations into visual and audio alerts in an
OBS Browser Source. The widget is an ordinary HTTPS page; it does not require
an OBS plugin or a companion desktop application.

## Domain language

- A **donation alert** is a visual and audio presentation of a donation for its streamer. One
  donation can have an incoming alert and later replays, while a test alert has no donation. Use
  donation alert rather than notification, queue item, or donation when referring to the
  presentation.
- An **alert playback** is one attempt to present a donation alert in the alert widget. Its kind is
  incoming, replay, or test, and its presentation is fixed while it is queued or playing. Recent
  terminal history may release media references during retention cleanup. Use alert playback
  rather than donation or event for the attempt.
- An **incoming alert** is the single automatic alert playback created for a newly accepted eligible
  donation. Initial donation history never creates incoming alerts; do not call those historical or
  imported alerts.
- An **alert replay** is a new alert playback for a donation that already has an incoming or replay
  playback. It never creates or changes a donation, so it is neither a retried nor a duplicate
  donation.
- The **alert widget** is the playback-only browser page that a streamer adds to OBS using a secret
  link. It is neither an OBS plugin nor an alert dashboard.
- The **active alert player** is the one alert widget instance currently allowed to consume a
  streamer's alert playbacks. Other instances are standby players until the active player leaves;
  the active player is not a primary OBS instance or an owner.
- An **interrupted playback** started but has no provable completion. It requires an explicit replay
  and never returns to the automatic queue; it is neither a failed donation nor a pending alert.

## System boundaries

The donations service owns donation alert configuration, ingestion, media,
text-to-speech preparation, the durable playback queue, and player leases. The
web application authenticates streamers, exposes the public widget, and relays
commands to the private donations service.

```text
Donation platform
       |
       v
apps/donations -- transaction --> donation + donation_alert_playback
       |                                      |
       |                                      v
       |                              TTS preparation worker
       |                                      |
       +----------------- private HTTP -------+
                              |
                              v
             apps/web tRPC commands, NDJSON stream,
                        and media proxy
                              |
                              v
                       OBS Browser Source
```

The existing `apps/alerts` and `internal/alerts` packages send operational
Telegram notifications. User-facing donation alerts live in
`internal/donationalert` so the two meanings remain separate.

## Donation ingestion

Alert creation is part of the same PostgreSQL transaction as donation
insertion. An alert is eligible only when all of these conditions hold:

- the donation was inserted for the first time;
- alerts are enabled for the user and donation source;
- the donation belongs to a live or recovery batch rather than the initial
  connection import;
- the donation is inside the freshness window.

The uniqueness constraint on `(user_id, source, source_donation_id)` and
`INSERT ... ON CONFLICT DO NOTHING RETURNING donation_id` prevent duplicate
source deliveries from creating duplicate automatic alerts. The alert stores
the original donation amount and currency. Video queue currency and video
priority never affect alert presentation.

Initial provider history never creates alerts. Fresh recovery batches may
create alerts because they can contain events missed during a transient source
disconnect. The freshness window is ten minutes, measured conservatively from
both source occurrence and StreamBrew acceptance. After live listeners subscribe,
bounded recent-history recovery runs immediately at service startup and every
five minutes, half of the freshness window. DonationAlerts recovery inspects
every response in a hard four-page budget and filters donations by occurrence
time without assuming that provider pages are ordered. Four recovery workers
isolate accounts with slow responses; every account has a 45-second pass
deadline and every provider request has a ten-second deadline. One shared
application limiter spaces all DonationAlerts REST requests at least 1.05
seconds apart. OAuth, token refresh, and listener setup preempt history. Recent
recovery receives a permit after at most four consecutive critical requests,
and regular history receives a permit after at most four consecutive recovery
permits. This bounded scheduling lets listeners, recent recovery, and the
hourly full-history import all make progress. The next full import is scheduled
one hour after the previous pass finishes. Each user retains at most 100
preparing or pending items; older overflow is marked expired. Opening OBS
therefore cannot play an unbounded stale burst.

## Queue and playback

The donation and presentation fields of an active playback are snapshots. They include
the source, donor, message, original amount and currency, image and regular
sound references, duration, volumes, voice, and accent color that applied when
the playback was accepted. Lifecycle fields remain mutable: status, player
lease data, acknowledgements, diagnostics, and the generated TTS asset change
as the playback advances. Later setting changes affect future incoming and test
playbacks. A replay uses the original donation content with the current
presentation settings. Retention cleanup may release media references after a
playback becomes terminal; its text, amount, currency, state, and presentation
values remain in recent history.

The playback lifecycle is:

```text
preparing -> pending -> playing (claimed) -> completed
    |          |          |  |-------------> skipped
    |          |          |----------------> interrupted
    |          |---------------------------> pending or expired (not started)
    |---------------------------------------> expired
```

`preparing` means that server-side speech audio is being generated. Preparation
uses a two-minute lease and at most three attempts. A speech failure records a
diagnostic and advances the alert without speech, allowing the image, text, and
regular sound to play. Replay accepts only a donation-backed playback that has
already reached `completed`, `skipped`, `expired`, or `interrupted`; it creates a
new playback for that donation and never creates another donation.

StreamBrew grants one active widget a 15-second player lease per streamer. The
widget renews it every five seconds. Every heartbeat and acknowledgement carries
the player identifier and lease generation. A new lease remains inactive and
invisible in PostgreSQL until its first heartbeat reports the resolved source
state. A second copy of the same URL remains on standby and stays transparent.
The dashboard reports only the persisted active player; standby candidates
retry locally and are not listed. A failed heartbeat request caused by a
transient network or service error keeps the current identity and is retried;
an explicit invalid identity, missing token, lease conflict, or stream
revocation invalidates it immediately. PostgreSQL still expires an identity
that does not successfully renew within the lease.

The stream is a same-origin `POST /api/alerts/stream` request with an NDJSON
response. The request body contains the token and player identity. Playback,
control, revocation, and keepalive events are each one JSON object per line.
Opening the player and sending heartbeats and start/finish acknowledgements use
tRPC mutations. This avoids putting the capability into an EventSource URL and
keeps durable playback state in PostgreSQL rather than in a browser connection.
The Go service serializes 64-bit donation IDs as decimal strings on the wire so
JavaScript never rounds them; `null` is used for test playbacks.

`queue_sequence` records StreamBrew acceptance order. The player cannot claim a
later pending playback while an earlier fresh playback is still preparing or
pending, and a database constraint permits at most one `playing` row per user.
The server sets `playing` when it assigns work, while `started_at` records the
renderer commitment immediately before the enter animation. The browser
preloads the assets and retries this acknowledgement for up to 15 seconds; it
does not render the card first. If the player lease is lost, the source becomes
inactive, the stream closes, or the token rotates before that acknowledgement,
a fresh item returns to `pending`; an old item expires. After the
acknowledgement, the same events make the item `interrupted`, because replaying
it automatically could duplicate audio for viewers. The renderer retries its
finish acknowledgement for up to 110 seconds while it still owns the player.
Each individual acknowledgement request has a five-second deadline and aborts
both the browser-to-web and web-to-donations requests before retrying. A started
playback that lacks a finish acknowledgement for two minutes is interrupted by
the server. Donation-backed terminal items remain available for manual replay
while they are present in recent history.

Pausing stops the next item from being claimed and lets the current item finish.
Skipping stops the current playback, or discards the next pending item if there
is no current playback. The local dashboard preview uses sample data and never
joins this queue. **Test in OBS** creates a real test playback.

## OBS setup

On the **Alerts** page, create an OBS link and copy it immediately. The secret is
placed in the URL fragment, for example `/alerts/overlay#<token>`. Fragments are
not sent in the initial HTTP request, so the secret does not enter access logs
or server-side route handling during navigation. The page reads it in the
browser and uses it only in subsequent POST request bodies. StreamBrew stores only
the token's SHA-256 hash, so the full link is shown once. Rotating the link
revokes the previous link and closes open widget sessions.

Add the link to OBS as a **Browser Source** with these initial settings:

| Setting                                   | Value    |
| ----------------------------------------- | -------- |
| Width                                     | `800`    |
| Height                                    | `600`    |
| FPS                                       | `30`     |
| Control audio via OBS                     | Enabled  |
| Shutdown source when not visible          | Disabled |
| Refresh browser when scene becomes active | Disabled |

The widget document is transparent in its initial server response and renders
no navigation, errors, or diagnostics over the stream. OBS visibility and
activity events are combined with document visibility. The widget waits one
second for OBS's initial active and visible events. If OBS does not send one of
them, it resolves the missing state from the known document visibility. It
claims work only while the resolved active and visible states are true, and
stops current audio when either becomes false. The browser source should
normally be reused between scenes rather than copied.

OBS sends widget audio to its source channel. Configure monitoring in the OBS
audio mixer and verify the result in a recording; headphone monitoring alone
does not prove that the program output contains the sound.

## Alert presentation and media

The initial presentation template supports an optional configured image, donor
name, original amount and currency, message, a fixed enter/exit animation, a
regular sound, and optional Russian text-to-speech. The dashboard preview and
public widget share the same renderer and 800 by 600 stage. The renderer
preloads all configured assets, plays the regular sound and TTS in sequence,
and does not exit before the configured display duration has elapsed. Each audio
track has a 35-second watchdog, so a broken media element cannot hold the queue
indefinitely.

Uploads are treated as untrusted data. The web endpoint requires an
authenticated same-origin multipart request, a dedicated request header, and a
known `Content-Length`; it also counts the streamed body, so a false smaller
length cannot bypass the 11 MiB limit. One upload is admitted at a time in each
web and donations-service process, a second request receives `429`, and the
complete web-to-service operation has a 45-second deadline. Images are
limited to PNG, JPEG, WebP, or GIF, 4 MiB, 4096 pixels on either axis, and 16
megapixels. StreamBrew checks signatures against the decoded codec, requires one
image stream, performs a full bounded decode, and rejects SVG. Animation work is
limited to at most 300 frames and 240 million decoded pixels.

Sounds are limited to supported WAV, MP3, Ogg, or Opus input, 10 MiB, and 30
seconds. Input must contain one audio stream and no video stream. StreamBrew checks
the signature and codec, strips metadata, and normalizes output to stereo,
48 kHz, 64 kbit/s Ogg Opus capped at 2 MiB. Assets are immutable and stored in
PostgreSQL so all service replicas and backups see the same bytes.

Speech is prepared on the server with eSpeak NG's Russian voice, then normalized
to Ogg Opus with FFmpeg. TTS input must be valid UTF-8 and is capped at both 500
Unicode code points and 4 KiB. Whitespace is normalized, and any remaining
control characters are rejected. Identical generated audio is deduplicated by
its content hash. The production image includes both command-line tools; no
external speech credentials are required.

Native media commands share a process-wide budget of two concurrent commands.
Each probe, decode, transcode, or speech command has a ten-second timeout;
FFmpeg and FFprobe also receive a 256 MiB maximum single-allocation limit. These
limits, the upload admission gate, and the donations server's 30-second request
read deadline keep a burst of authenticated uploads from buffering an unbounded
number of files or spawning an unbounded number of decoders.

The runtime image redistributes the Debian `espeak-ng` and `ffmpeg` packages.
Their package notices and corresponding-source information remain available
under `/usr/share/doc` in the image. eSpeak NG is distributed under
[GPL-3.0-or-later](https://github.com/espeak-ng/espeak-ng/blob/master/COPYING),
while FFmpeg's effective license depends on the Debian build configuration; see
the [FFmpeg legal page](https://ffmpeg.org/legal.html).

## Security

The OBS link is a playback-only capability and is separate from the chat
overlay token and authenticated session. It cannot change settings or access
the dashboard. The service revalidates its hash while a stream is open so token
rotation revokes existing players rather than only future connections.

The fragment secret is never part of the initial HTTP request. After navigation,
the widget sends it only in POST bodies. It fetches assets through
`POST /api/alerts/media/:assetId`; the server resolves the token owner and checks
that the asset belongs to that user and is referenced by that user's current
`playing` playback. A token therefore cannot retrieve an older asset merely by
retaining its UUID. The authenticated dashboard uses `GET` on the same endpoint
with its session instead. Media responses preserve exact
types, byte-range headers, `nosniff`, and a same-origin resource policy, and use
private one-hour caching. The widget turns those responses into local blob URLs.
The widget document uses `no-referrer`, `noindex`, and `no-store` policies.
Donor-controlled values are rendered as text.

## Operations and diagnostics

The authenticated page reports the active player, its last heartbeat and OBS
active/visible state, queue depth, current playback, the 20 most recent
playbacks, and recorded media, speech, expiry, backlog, disconnect, rotation, or
playback-timeout details. Renderer media failures are reported back with stable
diagnostic codes. Each distinct renderer code is stored separately for its
playback, so simultaneous image and audio failures remain visible. The renderer
waits for these bounded diagnostic acknowledgements before its finish
acknowledgement. These diagnostics remain off the public widget.

| Diagnostic code       | Meaning                                                         |
| --------------------- | --------------------------------------------------------------- |
| `image_unavailable`   | The renderer could not load or decode the configured image.     |
| `sound_unavailable`   | The renderer could not load or play the regular sound.          |
| `tts_unavailable`     | Speech synthesis or TTS playback was unavailable.               |
| `audio_blocked`       | The browser rejected audio playback.                            |
| `alert_expired`       | The freshness window closed before playback.                    |
| `backlog_limit`       | The item expired when the pending queue exceeded its bound.     |
| `playback_timeout`    | A started item had no finish acknowledgement after two minutes. |
| `player_disconnected` | A started item lost its active player or OBS source.            |
| `overlay_rotated`     | A started item stopped because its OBS link was rotated.        |
| `playback_issue`      | A non-specific abnormal playback outcome was recorded.          |

`playback_timeout` and `overlay_rotated` are error-level diagnostics; the other
codes are warnings. Renderer diagnostics use the time the browser reported
them. Lifecycle diagnostics use the playback's finish time when present, then
its start time, then its creation time.

The alert workers run inside `apps/donations`; there is no additional service or
port. An hourly retention sweep keeps at most 20 terminal playbacks per user and
removes terminal history older than 30 days. It releases unselected media from
terminal snapshots, deletes unreferenced uploaded assets and generated TTS, and
keeps files still needed by preparing, pending, or playing alerts. **Remove**
deselects an image or sound immediately; if a queued playback still references
it, final byte deletion waits until that playback becomes terminal and the
retention sweep runs. PostgreSQL is the durable coordination point, and the existing
`DONATIONS_SERVICE_SECRET` protects all private alert endpoints. The only new
runtime dependencies are the `espeak-ng` and `ffmpeg` packages in the application
image.

Public tRPC request bodies are limited to 1 MiB before routing. Stream and media
POST bodies have smaller route-specific limits, and upload bytes use the
separate bounded multipart endpoint.

Apply the donation-alert migration before deploying application code that uses
this feature. Deployment requires an explicit manual run with
`apply_migrations=true`, as described in [deployment.md](deployment.md).

## Validation matrix

Before a release, verify:

- English and Russian dashboards at desktop and mobile widths in light and dark
  themes;
- the widget at exactly 800 by 600 over bright and dark footage;
- transparency before hydration and after reconnecting;
- image, regular sound, speech, silent fallback, and OBS mixer recording;
- hide/show, scene changes, Studio Mode, and browser-source refresh;
- two sources using the same link and standby promotion;
- donations service and web restarts while idle and during playback;
- test, pause, resume, skip, replay, burst ordering, expiration, and token
  rotation;
- invalid, oversized, spoofed, corrupt, and over-duration media.

The supporting protocol and product research lives in
[the OBS alert widget research](research/obs-alert-widget.md).
