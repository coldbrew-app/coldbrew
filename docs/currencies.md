# Currencies and video queues

Terminology in this document follows the [glossary](glossary.md).

Coldbrew preserves each donation's original `{ amount, currency }` as the
financial event received from a platform. Donations are never converted or
given a queue currency in the database.

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

When the video worker processes a donation, it uses the current user currency
and default rate table to store one converted amount on the video. A donation
in an unsupported source currency remains visible in its original currency;
its video is not assigned to a queue.
