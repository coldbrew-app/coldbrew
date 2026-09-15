# Currencies and video queues

Terminology in this document follows the [glossary](../AGENTS.md#glossary).

StreamBrew preserves each donation's original `{ amount, currency }` as the
financial event received from a platform. Donations are never converted or
given a queue currency in the database.

The original amount supports up to 20 digits before the decimal point and 18
after it. Its currency may be a three-letter fiat code or a provider's asset
label of up to 32 characters, for example `USDT (TRX)`. StreamBrew preserves
that label on the donation instead of collapsing assets from different
networks.

The first release supports RUB, USD, and EUR for queue conversion. Its default
rates are static: `1 USD = 90 RUB` and `1 EUR = 100 RUB`. They are not live
foreign-exchange rates.

Changing the queue currency requires a rate expressed as the number of smaller
currency units in one larger unit, for example `90 RUB` per `1 USD`. The form
prefills the rounded rate derived from the static table; the user may replace
it.
The operation atomically converts existing video amounts and priority
thresholds. A video's queue assignment is retained;
assignments are not recalculated during the currency change.

When the video worker processes a donation, it uses the current user queue
currency and default rate table to store one converted queue amount on the
video. A donation in an unsupported original currency remains visible with its
original amount and currency. Its videos stay in their assigned video queue,
but their `queue_amount` and `video_priority_id` remain `NULL` until an amount
can be assigned.
