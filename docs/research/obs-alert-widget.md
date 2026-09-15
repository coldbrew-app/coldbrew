# Custom OBS alert widget

Research date: September 11, 2026. This document records the research that informed StreamBrew's own alert widget. The implemented architecture and operating guide live in [Donation alerts](../donation-alerts.md).

## Requirements established by the research

The widget is a standalone HTTPS HTML/CSS/JavaScript page added as an OBS Browser Source. It receives StreamBrew events, displays the donor, original amount, and message, and plays audio. No native plugin, obs-websocket, or locally installed application is required: the CEF-based Browser Source ships with official OBS builds. See [obs-browser](https://github.com/obsproject/obs-browser).

OBS defines the viewport through Width and Height and supports a transparent background. The page should make `html`, `body`, and its root transparent, hide overflow, preload images, and adapt the alert card to the viewport. See [Browser Source](https://obsproject.com/kb/browser-source).

## Recommended initial OBS settings

| Setting                                   | Recommendation                                                  |
| ----------------------------------------- | --------------------------------------------------------------- |
| URL                                       | Secret URL issued by StreamBrew; no sign-in inside OBS          |
| Size                                      | 800×600; position the source in the scene                       |
| Frame rate                                | 30 FPS for simple animations                                    |
| Shutdown source when not visible          | Off, so the page survives scene changes                         |
| Refresh browser when scene becomes active | Off, so scene changes do not reload the player                  |
| Control audio via OBS                     | On; adjust it in the OBS mixer                                  |
| Page permissions                          | No control permission; READ_OBS only if output status is needed |

Browser audio reaches OBS as source audio; monitoring is configured separately. Validate the result in a recording, not only through headphones. See the [official localization](https://raw.githubusercontent.com/obsproject/obs-browser/master/data/locale/en-US.ini), [browser audio implementation](https://github.com/obsproject/obs-browser/blob/master/browser-client.cpp), and [Audio Mixer Guide](https://obsproject.com/kb/audio-mixer-guide).

## Lifecycle, scenes, and audio

Current OBS integrations use window events:

- `obsSourceVisibleChanged` with Boolean `event.detail.visible`;
- `obsSourceActiveChanged` with Boolean `event.detail.active`.

The older callbacks are deprecated. If Shutdown is enabled, hiding the source destroys the browser. These events describe source state and do not prove viewer display. OBS does not publicly document a getter for the initial active or visible state, so initial readiness, Studio Mode, Preview versus Program, and transitions require practical testing. See the [JavaScript bindings](https://github.com/obsproject/obs-browser#js-bindings) and [source implementation](https://github.com/obsproject/obs-browser/blob/master/obs-browser-source.cpp).

A hidden or inactive player should not start another alert. A scene change during playback should record an interrupted state. Reuse one source across scenes; multiple independent instances of one URL still need server-side protection against duplicate audio.

StreamBrew consequently combines OBS events with document visibility and waits
briefly for the initial active and visible events before opening a player. If
OBS omits either event, document visibility supplies the missing state. In an ordinary browser, where
`window.obsstudio` is absent, the page is treated as active and visible for
testing.

obs-browser currently enables autoplay without a user gesture, but the player must handle playback rejection and normal-browser preview needs an explicit audio-start control. See [BrowserApp::OnBeforeCommandLineProcessing](https://github.com/obsproject/obs-browser/blob/master/browser-app.cpp).

Generate TTS audio on the server to keep the voice consistent across computers. Browser `speechSynthesis` depends on locally available voices and may return an empty list. See [Web Speech API: getVoices](https://webaudio.github.io/web-speech-api/#dom-speechsynthesis-getvoices).

Suggested playback sequence: preload → enter → sound → TTS → exit → completion acknowledgement. Every media item needs a timeout and fallback, and long speech must not overlap the next alert.

## Integration chosen for StreamBrew

The implementation reuses the established boundaries around the
[chat overlay](../../apps/web/src/routes/chat.overlay.$token.tsx), authenticated
tRPC, idempotent [donation persistence](../../internal/donations/store.go), and
leased [PostgreSQL jobs](../../internal/videoingest/store.go). Donation alerts
have a separate token and domain because they grant audio playback and have a
durable acknowledgement lifecycle.

```text
Sources → apps/donations → PostgreSQL: donation + alert job
                                  ↓
                        media / TTS preparation
                                  ↓
               apps/web: tRPC commands + POST NDJSON
                                  ↓
                    /alerts/overlay#<token> in OBS
                                  ↓
                       start / finish commands
```

A module under `internal/donationalert`, run inside `apps/donations`, owns preparation, the durable queue, and playback state. The existing `internal/alerts` package retains its separate responsibility for operational Telegram notifications. The donation and eligible alert playback are inserted atomically. `apps/web` authenticates either the streamer or an overlay token and relays the private service contract. A separate deployment is unnecessary.

The widget opens and controls its player with ordinary tRPC mutations. Its live
channel is a same-origin POST whose response is newline-delimited JSON. A POST
body can carry the fragment capability and player identity, while the browser's
native `EventSource` interface would require credentials in a URL. The response
contains playback, control, revocation, and keepalive records. Caddy must flush
the streaming response promptly; see
[Caddy streaming](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#streaming).
Receipt of any streamed record is not proof that an animation completed, so
start and finish acknowledgements and all authoritative state remain in
PostgreSQL.

Media uses `/api/alerts/media/:assetId`. The widget sends its token in a POST
body; the authenticated dashboard uses a session-authenticated GET. Both paths
check asset ownership before returning bytes. The token path additionally
requires the asset to belong to the current `playing` playback. The widget
creates local blob URLs from the responses, so the capability is not placed in
media URLs.

## Queue and recovery rules

1. Create alerts only for first-time inserts from enabled sources after alerts
   are enabled. Exclude initial history; apply a freshness window to recovered
   events. Subscribe live listeners and reconcile history immediately at
   service startup, then repeat recovery often enough to remain inside that
   window. Bound this latency-sensitive pass by both event time and page count;
   inspect the complete bounded page window instead of assuming undocumented
   provider ordering, and run any full lifetime-history import independently.
2. Use the donation's original amount and currency. Video queue currency and priority do not affect alerts.
3. Order strictly by StreamBrew acceptance. Store a stable queue sequence,
   donation reference, and presentation snapshot. An earlier preparing or
   pending item blocks later work until it becomes playable or terminal.
4. Grant one active player per streamer a time-limited lease with heartbeat and
   generation checks. Retry transient heartbeat failures while the lease can
   still be renewed, and invalidate immediately on an explicit lease rejection
   or stream revocation. Client local storage is not authoritative.
5. Use preparing, pending, playing, completed, skipped, expired, and interrupted
   states. Return a fresh claimed item to pending when its player disappears
   before the start acknowledgement. Expire it if its freshness window has
   closed. Once started, interruption or acknowledgement timeout is terminal and
   offers manual replay instead of risking duplicate audio.
6. Keep fresh alerts while no player is connected, but expire them before OBS can replay a large stale burst. Provide pause, skip, and backlog limits.
7. Dashboard preview uses sample data and never joins the live queue. Test in OBS
   is a separate action. Replay accepts a donation-backed terminal playback and
   creates another playback job for that donation, not another donation. The
   64-bit donation ID crosses the JavaScript boundary as a decimal string.
8. Keep only bounded terminal history, release unselected terminal media, and
   delete unreferenced uploads and generated speech on a periodic retention
   sweep. Files referenced by active queue states remain available until those
   playbacks become terminal.

The implemented URL is `/alerts/overlay#<token>`. The URL fragment is not sent
with the initial navigation request. Client code reads it and sends the separate,
playback-only alert token in POST request bodies. Rotation terminates already
open sessions and invalidates later media requests.

Keep the token out of analytics and logs and send `Referrer-Policy: no-referrer`. Render donor input as text. Start with controlled presets and validated uploads rather than arbitrary user code. Bound file type, size, and duration; store media where every replica can access it.

Transparency must be present in the initial server HTML. The overlay must never render application navigation, loading skeletons, development banners, or connection errors over the stream. Put connection, heartbeat, queue, and media diagnostics on the authenticated `/alerts` page.

## Release scope and validation

The implemented release includes one image, donor, original amount, and message
template; a simple animation; regular sound; volume and duration controls;
source selection; a secret fragment URL; dashboard preview; Test in OBS; pause,
skip, replay; a durable queue; diagnostics; and server-generated Russian TTS
with a visual-and-sound fallback. Arbitrary templates and complex amount rules
remain outside this scope.

Validation against target OBS versions should cover transparency, test audio, initial active and visible state, two scenes, Studio Mode, and reconnection. The full matrix also covers supported operating systems, restart without replay, duplicate sources, network and media failures, bursts, and audio routing into a recording.

The implementation follows this design; see [Donation alerts](../donation-alerts.md) for its current behavior and deployment requirements.
