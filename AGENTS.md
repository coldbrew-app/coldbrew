# Coldbrew

This app is created for streamers. It connects to many donation platforms (such as donationalerts.com), fetches donates from all of them and displays them all in one place.

## Keeping this file current

This file is a failure log, not a wishlist. Every line below exists because it went wrong at least once.

When you make a mistake, get corrected by user, or discover something about this codebase that wasn't written down:

1. Add one line to the failure log below, in the imperative, describing the correct behaviour.
2. Keep it specific to this repo. General advice belongs nowhere.
3. If the fix is a workflow rather than a rule, put it in `.agents/skills/` and link it from here.
4. Include the change in the same commit and mention it in your summary.

Keep this file under 500 lines. It is loaded into every session, and long context makes you less reliable, not more. If a section outgrows its usefulness, move it to `api/AGENTS.md`.

## Libraries

- Use `tRPC` for client-server interactions
- Wrap `fetch`-requests to foreign services into neverthrow's `Result` to improve durabilty
- Use `shadcn` for UI components

## Frontend Styling

- Use `tailwindcss` for styling
- Use `flex`, `gap` and `padding` instead of margins wherever possible
- Pass external positioning (`margin`, `width`, `grow` etc) of the root element of components via `className` instead of hardcoding it inside component. It is similar to modifiers in BEM methodology.

## Scripts

Add helper scripts to `justfile`, not `package.json`

## Check yourself

- `just typecheck` - for typechecking
- `just fmt` - for formatting
- Make sure that file `vite.config.js` does not exist. You already have `vite.config.ts`.

## Code style

- variables of types `Result` and `ResultAsync` from "neverthrow" should start with `$` (for example: `const $donations = ResultAsync.fromPromise(...)`)
- avoid mutating objects

## Failure log

- Validate this repository's Compose file with `deployment.env.example` and `APP_ENV_FILE`; never run `docker compose config` against a real production env file because it prints resolved secrets.
- Include only encrypted `.env.prod` (never `.env.keys` or other env files) in the Docker build context.
- Never log parsed application environment objects because they contain production secrets.
- Pass `/app/.env` explicitly to the Docker dotenvx entrypoint because the web service changes its working directory.
