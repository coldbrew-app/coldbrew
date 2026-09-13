# Donation alerts through existing widgets

Checked on September 11, 2026 against official documentation. This document
records the third-party-widget option considered before Coldbrew implemented
its own widget. The research itself changed no code or data schema and sent no
alert to a real account.

## Conclusion

The simplest first version would send custom alerts through the DonationAlerts API while the streamer keeps using the standard DonationAlerts widget. Streamlabs offers a similar API and could be a second adapter. None of the services reviewed documents a supported mode in which its standard widget accepts an arbitrary backend URL. The no-custom-widget flow would therefore be **donation source → Coldbrew → alert service API → the service's OBS widget**.

An OBS Browser Source URL identifies the page to render, not a universal event-server endpoint. Pointing it at Coldbrew requires a Coldbrew widget page, although it does not require a native OBS plugin. See [OBS Browser Source](https://obsproject.com/kb/browser-source).

## DonationAlerts

The standard widget supports templates, images or GIFs, sounds, fonts, and amount-threshold TTS. See the [DonationAlerts setup guide](https://www.donationalerts.com/help/getting-started).

`POST https://www.donationalerts.com/api/v1/custom_alert` creates a custom alert and requires the `oauth-custom_alert-store` scope. The streamer must configure a **Custom alerts** widget variation. This creates an alert, not a donation record. Limits include 32 characters for `external_id`, 255 for `header`, 300 for `message`, and 255 for media URLs. The shared HTTP limit is **60 requests per minute per application**. See the [DonationAlerts API](https://www.donationalerts.com/apidoc).

The documentation does not guarantee idempotency for `external_id`, and describes `is_shown` ambiguously. The API exposes no distinct amount, currency, or TTS fields. An amount can be placed in the header, but ordinary-donation amount rules and speech behavior are not proven to carry over. An HTTP success also does not prove that viewers saw the alert.

## Streamlabs

`POST https://streamlabs.com/api/v2.0/alerts` triggers a custom alert. Its `type` selects an Alert Box category such as `donation`; other parameters cover text, image, sound, duration, and highlight color. Empty media URLs use the defaults. It requires `alerts.create`; queue, pause, mute, and skip controls use the separate `alerts.write` scope. See the [Alerts API](https://dev.streamlabs.com/reference/alerts) and [Scopes](https://dev.streamlabs.com/docs/scopes).

Streamlabs recommends **two alerts per minute per user**. It separately publishes API tiers of five requests per minute for TESTING and 2,400 for APPROVED; applicability to production alerts needs confirmation. See [Triggering alerts](https://dev.streamlabs.com/docs/triggering-alerts) and [Tiers](https://dev.streamlabs.com/docs/tiers).

Do not use `POST /api/v2.0/donations` merely to display an alert: that endpoint creates a donation in external history. The custom-alert endpoint has no documented idempotency key and does not prove that amount-based variations or TTS settings carry over.

## StreamElements

StreamElements Custom Widgets can call external APIs, but that still means developing and maintaining HTML, CSS, and JavaScript inside another service's editor. See [Overlays](https://docs.streamelements.com/overlays) and [Custom Widget](https://docs.streamelements.com/overlays/custom-widget).

Its official OpenAPI contains a socket endpoint without a documented event body or exact scope. Tip creation writes an external tip record, while activity replay only repeats an existing activity. This is not a sufficiently clear custom-alert contract. See the [official specification](https://github.com/StreamElements/api-docs/blob/main/api.yaml).

## Historical third-party delivery proposal

- Separate the donation source from the display destination. Let the streamer choose one destination and which sources to forward.
- Create a delivery job only for a newly accepted eligible donation, atomically with its PostgreSQL insert. Explicitly exclude initial history import and apply a freshness policy to outage recovery.
- Run delivery asynchronously in `apps/donations`. Donation ingestion must not wait for an alert provider, and delivery state must remain separate from the immutable original amount and currency.
- Persist attempts, retry time, errors, expiration, and the returned external ID. Do not promise exactly-once delivery: a timeout may occur after the provider accepts the request.
- Do not forward a donation back to the same service account that already displays it natively, or viewers will receive two alerts.
- Use the existing `/alerts` page for provider selection, OAuth, test alerts, and delivery status. Existing connections need additional send scopes.

At the time of this research, any implementation required a data schema change
and separate user confirmation under the repository rules. Before such a
release, the proposal would also have required tests for identical requests,
network interruption, long and Cyrillic messages, audio and TTS, a hidden
Browser Source, bursts, and a donation originating from the renderer itself.
Coldbrew subsequently chose and implemented its own Browser Source; its current
architecture and operating guide are documented in
[Donation alerts](../donation-alerts.md).
