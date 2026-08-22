# Coldbrew

This app is created for streamers. It connects to many donation platforms (such as donationalerts.com), fetches donates from all of them and displays them all in one place.

## Libraries

- Use `tRPC` for client-server interactions
- Follow the [data loading guide](docs/data-loading.md) when choosing between route loaders, `useQuery`, and `useSuspenseQuery`
- Wrap `fetch`-requests to foreign services into neverthrow's `Result` to improve durabilty
- Use `shadcn` for UI components

## Documentation

- Documentation files referenced by this guide may and should be edited whenever needed, and kept up to date with the codebase and project conventions.

## Frontend Styling

- Follow the [Coldbrew UI Style Guide](docs/ui-style-guide.md) for visual direction, semantic colors, typography, components, and responsive behavior
- Use `tailwindcss` for styling
- Use `flex`, `gap` and `padding` instead of margins wherever possible
- Pass external positioning (`margin`, `width`, `grow` etc) of the root element of components via `className` instead of hardcoding it inside component. It is similar to modifiers in BEM methodology.

## Scripts

Add helper scripts to `justfile`, not `package.json`

## Check yourself

- `just typecheck` - for typechecking
- `just fmt` - for formatting
- Make sure that file `vite.config.js` does not exist. You already have `vite.config.ts`.

## Creating new page

- every new page should declare a document.title like this:

  ```ts
  export const Route = createFileRoute("/donations")({
    component: DonationsLayout,
    head: () => ({ meta: [{ title: "Donations · Coldbrew" }] }),
  });
  ```

## Code style

- variables of types `Result` and `ResultAsync` from "neverthrow" should start with `$` (for example: `const $donations = ResultAsync.fromThrowable(...)(...)`)
- avoid mutating objects
- Follow the [SQL style guide](docs/sql-style.md) for schema and database queries.
