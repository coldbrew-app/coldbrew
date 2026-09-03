# Coldbrew

This app is created for streamers. It connects to many donation platforms (such as donationalerts.com), fetches donates from all of them and displays them all in one place.

## Glossary

Use these names consistently in product text, documentation, Go, TypeScript,
API schemas, SQL, and migrations. English identifiers use the names in the
**Code/DB** column; Russian UI copy uses the names in the **Russian** column.
Apply each language's casing conventions: SQL uses `snake_case`, TypeScript uses
`camelCase` or `PascalCase`, and Go uses `PascalCase` with initialisms such as
`ID` (for example, `SourceDonationID`).

| Term               | Russian                          | Code/DB                                      | Definition                                                                                                                     |
| ------------------ | -------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| donation           | донат                            | `donation` / `Donation`                      | An immutable support event received from a donation platform.                                                                  |
| donation source    | источник доната                  | `source` / `DonationSource`                  | The platform that supplied a donation, such as `donationalerts`.                                                               |
| source donation ID | идентификатор доната в источнике | `source_donation_id` / `sourceDonationId`    | The source-assigned identifier. Together with user and source, it makes a donation idempotent.                                 |
| original money     | исходная сумма                   | `amount`, `currency`                         | The amount and currency as reported by the source. It is stored only on `donation` and is never converted.                     |
| user               | стример                          | `"user"` / `UserInfo`                        | The Coldbrew account that owns donations and its video queue.                                                                  |
| queue currency     | валюта очереди                   | `user.queue_currency` / `queueCurrency`      | The one currency selected by a user for every queue amount and threshold. It is not duplicated in `video` or `video_priority`. |
| video              | видео                            | `video` / `Video`                            | A supported video link in the queue, originating from a donation or added manually by its owner.                               |
| video source       | источник видео                   | `Video.source`                               | Whether a video came from a `donation` or was added `manual` by the streamer.                                                  |
| manual video       | видео, добавленное вручную       | `video.user_id` / `video.added_at`           | A video added directly by the streamer without creating a donation.                                                            |
| queue amount       | сумма для очереди                | `video.queue_amount` / `queueAmount`         | The amount used to assign a video priority, expressed in the current user queue currency. `NULL` means it cannot be queued.    |
| video queue        | очередь видео                    | `/videos`                                    | The user's ordered collection of videos, organised by video priority. It is not a separate database table.                     |
| video priority     | очередь (уровень)                | `video_priority` / `VideoPriority`           | A user-defined threshold and label that groups videos in the video queue.                                                      |
| queue threshold    | порог очереди                    | `min_price_per_minute` / `minPricePerMinute` | The minimum queue amount per minute of watch time required for a video priority.                                               |
| default priority   | очередь по умолчанию             | `is_default` / `isDefault`                   | The zero-threshold video priority used when no higher threshold applies.                                                       |
| queue assignment   | назначение в очередь             | `video_priority_id` / `videoPriorityId`      | The video priority selected for a video. It remains unchanged when the user changes queue currency.                            |
| unparsed donation  | необработанный донат             | `videos_parsed_at IS NULL`                   | A donation whose message has not yet been scanned for supported video links.                                                   |
| parsed donation    | обработанный донат               | `videos_parsed_at`                           | A donation whose video-link scan has completed, including when it produced no videos.                                          |
| watched video      | просмотренное видео              | `watched_at` / `watchedAt`                   | A video marked as watched by its owner.                                                                                        |
| bookmarked video   | видео в закладках                | `bookmarked_at` / `bookmarkedAt`             | A video bookmarked by its owner.                                                                                               |
| video start        | начало видео                     | `start_seconds` / `startSeconds`             | The offset in seconds where playback of a video begins.                                                                        |
| video end          | окончание видео                  | `end_seconds` / `endSeconds`                 | The offset in seconds where playback of a video ends.                                                                          |
| watch time         | время просмотра                  | `endSeconds - startSeconds`                  | The exact duration of the selected video segment. It is calculated and is not stored separately.                               |

### Invariants

- Do not call a `donation` a queue item: a donation may create zero or more videos.
- Do not create a synthetic `donation` for a manual video. A video belongs either to a donation or directly to its owning user.
- Do not store or describe a converted amount on a donation. The converted value is always a video `queue_amount`.
- Do not add a currency field to videos or priorities. Their currency is the owning user's `queue_currency`.
- Use **video priority** for the persisted grouping; use **video queue** for the overall `/videos` product surface.

## Repository structure

- `apps/web` and `packages` contain the TypeScript web application and shared TypeScript packages.
- `apps/chat`, `apps/donations`, and `apps/video` are Go service entrypoints; their application packages live under `internal`.
- `db` and the API wire contracts are shared boundaries. Keep their terminology and behavior consistent across both languages.

## Code style

- Normalize untrusted input once at its seam into a canonical domain value; downstream code compares, stores, and keys that canonical value rather than the raw input.
- Treat a module's public interface as its test surface. Do not widen a public API or add dependency injection solely for tests.
- Remove legacy code and compatibility paths instead of preserving them, but always ask for the user's explicit permission before removing them.

## TypeScript and TSX

<!-- intent-skills:start -->

### Skill Loading

Before editing TS and TSX files for a substantial task:

- Run `bun intent list` from the workspace root to see available local skills.
- If a listed skill matches the task, run `bun intent load <package>#<skill>` before changing files.
- Use the loaded `SKILL.md` guidance while making the change.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.

<!-- intent-skills:end -->

### Libraries

- Use `tRPC` for client-server interactions. A tRPC wire contract may be implemented by a Go service; keep its TypeScript contract and Go implementation synchronized.
- Follow the [data loading guide](docs/data-loading.md) when choosing between route loaders, `useQuery`, and `useSuspenseQuery`.
- Use `shadcn` for UI components.

### Code style

- Avoid mutating objects.

### Creating new page

- Every new page should declare a document title like this:

  ```ts
  export const Route = createFileRoute("/donations")({
    component: DonationsLayout,
    head: () => ({ meta: [{ title: "Donations · Coldbrew" }] }),
  });
  ```

### Frontend styling

- Follow the [Coldbrew UI Style Guide](docs/ui-style-guide.md) for visual direction, semantic colors, typography, components, and responsive behavior.
- Follow the icon section of the [Coldbrew UI Style Guide](docs/ui-style-guide.md#interface-icons) when choosing or adding UI icons.
- Use `tailwindcss` for styling.
- Use `flex`, `gap` and `padding` instead of margins wherever possible.
- Pass external positioning (`margin`, `width`, `grow` etc.) of the root element of components via `className` instead of hardcoding it inside the component. It is similar to modifiers in BEM methodology.

## Go

- Use the repository-wide `just` recipes for formatting, tests, and checks; they include the Go services and their `internal` packages.
- Read the relevant domain guide before changing a Go service, especially the multichat architecture and shared SQL rules.

## Documentation

- Documentation files referenced by this guide may and should be edited whenever needed, and kept up to date with the codebase and project conventions.
- Read [the multichat architecture](docs/multichat.md) before changing chat providers, collectors, streams, overlays, or related external-service integrations.
- In TypeScript, follow the [error-handling guide](docs/errors.md) when working with HTTP requests, subscriptions, streams, workers, or other external failures.
- Follow the [React guide](docs/react.md) when creating or changing React hooks or their consumers in `apps/web`.
- Follow the [SQL guide](docs/sql.md) when editing PostgreSQL schemas or SQL embedded in Go or TypeScript.
- In TypeScript, follow the [Zod guide](docs/zod.md) when creating or changing Zod schemas.
- Follow the [internationalization guide](docs/i18n.md) when changing localized UI copy, locale handling, or locale-sensitive formatting.
- Follow the [SSR and hydration guide](docs/ssr-and-hydration.md) when working on server-rendered UI, route context, browser-persisted state, or hydration warnings in `apps/web`.

## Scripts

Add helper scripts to `justfile`, not `package.json`

## Development environment

- Agents work in a development environment and may run `just schema-apply` without asking for confirmation whenever `db/schema.sql` changes or the current development database needs to be brought up to date.
- This permission applies only to the non-destructive schema apply command. Database reset, destruction, or removal of volumes still requires explicit user authorization.

## Check yourself

- `just typecheck` - type-checks TypeScript and compiles and tests the Go service packages.
- `just test` - runs the TypeScript and Go test suites.
- `just fmt` - formats TypeScript, Go, Markdown, and other supported files.
- `just check` - runs linting, formatting checks, and both test suites.
- Make sure that file `vite.config.js` does not exist. You already have `vite.config.ts`.
