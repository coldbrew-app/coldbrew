# Glossary

Use these names consistently in product text, documentation, TypeScript, API
schemas, SQL, and migrations. English identifiers use the names in the
**Code/DB** column; Russian UI copy uses the names in the **Russian** column.

| Term               | Russian                          | Code/DB                                      | Definition                                                                                                                      |
| ------------------ | -------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| donation           | донат                            | `donation` / `Donation`                      | An immutable support event received from a donation platform.                                                                   |
| donation source    | источник доната                  | `source` / `DonationSource`                  | The platform that supplied a donation, such as `donationalerts`.                                                                |
| source donation ID | идентификатор доната в источнике | `source_donation_id` / `sourceDonationId`    | The source-assigned identifier. Together with user and source, it makes a donation idempotent.                                  |
| original money     | исходная сумма                   | `amount`, `currency` / `money`               | The amount and currency as reported by the source. It is stored only on `donation` and is never converted.                      |
| user               | стример                          | `"user"` / `UserInfo`                        | The Coldbrew account that owns donations and its video queue.                                                                   |
| queue currency     | валюта очереди                   | `user.queue_currency` / `queueCurrency`      | The one currency selected by a user for every queue amount and threshold. It is not duplicated in `video` or `video_priority`.  |
| video              | видео                            | `video` / `Video`                            | A supported video link extracted from a donation message.                                                                       |
| queue amount       | сумма для очереди                | `video.queue_amount` / `queueAmount`         | The donation amount converted into the current user queue currency when the video is created. `NULL` means it cannot be queued. |
| video queue        | очередь видео                    | `/videos`                                    | The user's ordered collection of videos, organised by video priority. It is not a separate database table.                      |
| video priority     | очередь (уровень)                | `video_priority` / `VideoPriority`           | A user-defined threshold and label that groups videos in the video queue.                                                       |
| queue threshold    | порог очереди                    | `min_price_per_minute` / `minPricePerMinute` | The minimum queue amount per minute of watch time required for a video priority.                                                |
| default priority   | очередь по умолчанию             | `is_default` / `isDefault`                   | The zero-threshold video priority used when no higher threshold applies.                                                        |
| queue assignment   | назначение в очередь             | `video_priority_id` / `videoPriorityId`      | The video priority selected for a video. It remains unchanged when the user changes queue currency.                             |
| unparsed donation  | необработанный донат             | `videos_parsed_at IS NULL`                   | A donation whose message has not yet been scanned for supported video links.                                                    |
| parsed donation    | обработанный донат               | `videos_parsed_at`                           | A donation whose video-link scan has completed, including when it produced no videos.                                           |
| watched video      | просмотренное видео              | `watched_at` / `watchedAt`                   | A video marked as watched by its owner.                                                                                         |
| saved video        | сохранённое видео                | `saved_at` / `savedAt`                       | A video marked as saved by its owner.                                                                                           |
| video start        | начало видео                     | `start_seconds` / `startSeconds`             | The offset in seconds where playback of a video begins.                                                                         |
| video end          | окончание видео                  | `end_seconds` / `endSeconds`                 | The offset in seconds where playback of a video ends.                                                                           |
| watch time         | время просмотра                  | `endSeconds - startSeconds`                  | The exact duration of the selected video segment. It is calculated and is not stored separately.                                |

## Invariants

- Do not call a `donation` a queue item: a donation may create zero or more videos.
- Do not store or describe a converted amount on a donation. The converted value is always a video `queue_amount`.
- Do not add a currency field to videos or priorities. Their currency is the owning user's `queue_currency`.
- Use **video priority** for the persisted grouping; use **video queue** for the overall `/videos` product surface.
