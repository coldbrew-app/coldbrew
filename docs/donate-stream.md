# donate.stream

Coldbrew receives donate.stream donations through the same `apps/donations` service that owns the
DonationAlerts integration. donate.stream does not publish a third-party OAuth flow or API
documentation. The integration follows the protocol used by its alert widget.

The streamer opens [alert widgets](https://lk.donate.stream/widgets/alert/all) in donate.stream and
copies the full **Alert widget address**. It has this form:

```text
https://donate.stream/widget-alert?uid=…&token=…
```

Coldbrew accepts only HTTPS addresses on `donate.stream` with the `/widget-alert` path and one `uid`
and `token` parameter. It validates the token over
`wss://donate.stream/wss/socket.io/?EIO=4&transport=websocket` before saving the connection, then
authenticates with `auth.token`, joins the `donates` and `widget-alerts` channels, and listens for
`alert` events.

The widget address is a credential because it grants access to incoming alert data. Coldbrew stores
the widget group UID and token, never returns either value to the browser, and removes only the
matching saved connection if donate.stream later rejects its token.

An alert's `message_uid` is stored as `source_donation_id`. The `sum` and `currency` reported by
donate.stream are stored as the immutable donation `amount` and `currency`; Coldbrew does not convert
them. The widget event does not include the payment time, so the time Coldbrew receives the event is
used for `source_created_at` and `occurred_at`.

The alert widget protocol exposes only live alerts, not donation history. Connecting this source
therefore receives new donations from that point onward and cannot repair events missed while the
listener or donate.stream is unavailable. Reconnecting with a different widget address replaces the
old connection and restarts its listener.
