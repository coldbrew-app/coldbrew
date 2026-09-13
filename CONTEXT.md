# Coldbrew context

The product glossary and invariants live in `AGENTS.md`. This file adds domain language for the
video queue, chat integration, and donation alert modules.

## Video queues

**Video queue**: A streamer's named collection of videos. Each video belongs to exactly one queue,
including before its duration is known.
_Avoid_: Tag, streaming platform

**Video priority**: A streamer-wide threshold level shared by every video queue.
_Avoid_: Queue (when referring only to a priority level)

## Chat integration

- **chat provider connection** — one OAuth grant from a Coldbrew user to one provider account.
  A user may have multiple connections for the same provider. Credentials belong to the chat
  aggregation module and never cross its external seam.
- **chat source** — one provider-owned channel whose messages are included in a user's multichat.
  Every source belongs to exactly one chat provider connection. Arbitrary public sources are not
  supported.
- **chat capability** — one operation a connection can perform: read, send, delete, timeout, ban,
  or unban. The UI derives available actions from capabilities instead of provider names.
- **broadcast message** — one user command that independently sends the same text to every enabled
  source with the `send_message` capability. Its result contains one outcome per source and is not
  transactional across providers.
- **chat aggregation module** — the separately deployed module that owns provider connections,
  collectors, provider webhooks, normalized events, moderation commands, broadcast messages, and
  the moderation audit. `apps/web` owns the public tRPC interface, Coldbrew authentication, and
  validation at the module's external seam.

## Donation alerts

**Donation alert**:
A visual and audio presentation of a donation for its streamer. One donation can have an incoming
alert and later replays, while a test alert has no donation.
_Avoid_: Notification, queue item, donation

**Alert playback**:
One attempt to present a donation alert in the alert widget. Its kind is incoming, replay, or test,
and its presentation is fixed while it is queued or playing. Recent terminal history may release
media references during retention cleanup.
_Avoid_: Donation, event

**Incoming alert**:
The single automatic alert playback created for a newly accepted eligible donation. Initial
donation history never creates incoming alerts.
_Avoid_: Historical alert, imported alert

**Alert replay**:
A new alert playback for a donation that already has an incoming or replay playback. It never
creates or changes a donation.
_Avoid_: Retried donation, duplicate donation

**Alert widget**:
The playback-only browser page that a streamer adds to OBS using a secret link.
_Avoid_: OBS plugin, alert dashboard

**Active alert player**:
The one alert widget instance currently allowed to consume a streamer's alert playbacks. Other
instances are standby players until the active player leaves.
_Avoid_: Primary OBS, owner

**Interrupted playback**:
An alert playback that started but whose completion cannot be proven. It requires an explicit
replay and never returns to the automatic queue.
_Avoid_: Failed donation, pending alert
