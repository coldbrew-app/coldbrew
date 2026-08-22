# SSR and hydration

Coldbrew uses TanStack Start for full-page server rendering. The first client
render must produce the same DOM as the HTML sent by the server. Treat a
hydration warning as a rendering bug until a specific unavoidable difference
has been identified.

## Choosing where state is resolved

- Use an awaited route loader for data that is needed to render the initial
  HTML. Follow the [data loading guide](data-loading.md) for query prefetching
  and navigation behaviour.
- Put request-derived values that affect shared UI, such as the viewer, locale,
  or theme, in route context. Resolve them on the server for the initial
  request and return the same value from the client path.
- Use client state only for interaction after hydration. Its initial value must
  be deterministic and match the server value.
- Do not read `window`, `document`, `localStorage`, `sessionStorage`, or
  `matchMedia` while deciding the first client render unless the server has
  supplied an equivalent snapshot.

## Theme

The selected theme is stored in the `theme` cookie. `dark` is the only
non-default value; absent or invalid values resolve to `light`.

1. The server branch of `getRoutePreferences` reads the cookie from the current request.
2. The root route puts the resolved `Theme` in route context.
3. `RootDocument` renders `className="dark"` on `<html>` when the context is
   dark.
4. The client router reads the same cookie before its first render.
5. The theme control updates React state and writes the cookie with a one-year
   lifetime.

This lets CSS apply the dark theme before first paint and keeps the server and
client trees identical. Do not use `localStorage` as a second source of truth
for the selected theme.

## Locale

The selected locale is stored in the `locale` cookie. Supported values are
`en` and `ru`; when the cookie is absent or invalid, the server falls back to
the request's `Accept-Language` header and the client falls back to
`navigator.language`.

1. The server branch of `getRoutePreferences` reads and resolves the value from the current request.
2. The root route puts the resolved `Locale` in route context.
3. `RootDocument` uses it for `<html lang>` and as the initial value for
   `I18nProvider`.
4. The client router and the root route read the same cookie before their first
   render.
5. Changing language updates the cookie and `document.documentElement.lang`.

Locale affects the document language, translated strings, and locale-sensitive
formatting. Keep the server and first client render on the same resolved locale
to prevent mismatches.

## Avoiding mismatches

Do not use these values directly in server-rendered component output:

- `Date.now()`, `new Date()`, or `Math.random()`;
- locale-sensitive formatting unless the server and client use the same locale
  and time zone;
- browser-only state or APIs;
- data that can change between SSR and hydration without being serialized with
  the page.

Pass a server-created snapshot through loader data or route context instead.
For intentionally client-only content, render the same placeholder on the
server and first client render, then update it in an effect.

Ensure rendered HTML has valid nesting. Browser DOM repair can turn valid JSX
into a different DOM tree before React hydrates it.

## `suppressHydrationWarning`

Use `suppressHydrationWarning` only for a known, unavoidable mismatch on the
element that carries it. It applies only one level deep; it does not hide
problems in descendant components and React does not patch a mismatched text
value.

Coldbrew applies it to `<html>` because browser extensions can add attributes
to that root element before React starts. It must not be used to mask
application-owned state such as the theme; make that state SSR-deterministic
instead.

## Debugging and review

When a warning occurs, inspect the React development diff before changing
code. It identifies the mismatched element and attributes.

- If the diff shows an unexpected root attribute or class, retry with browser
  extensions disabled or in a clean profile.
- If it shows application markup, compare the values used by SSR and the first
  client render; fix the data flow rather than suppressing the warning.
- Test a cold load and a reload with each persisted theme.
- Verify that no hydration warning is emitted and that the initial `<html>`
  class matches the chosen theme before the page becomes interactive.

Run `just typecheck`, `just fmt`, and the relevant web tests after changing
SSR or hydration behaviour.
