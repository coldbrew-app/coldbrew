# Internationalization

Coldbrew supports English (`en`) and Russian (`ru`). The interface language is
presentation state: it never changes domain values, database records, API
contracts, URLs, or identifiers. Keep product terminology consistent with the
[glossary](../AGENTS.md#glossary) in every locale.

## Locale resolution and persistence

`apps/web/src/lib/locale.ts` is the single locale boundary. It exports the
supported `locales`, the `Locale` type, the `locale` cookie name, and
`resolveLocale`.

Resolve untrusted locale input only with `resolveLocale`:

1. A valid `locale` cookie (`en` or `ru`) wins.
2. Otherwise, a Russian preferred language resolves to `ru`.
3. All other missing or invalid values resolve to `en`.

The request middleware normalizes the cookie on the server. The root route
uses the same resolver on both server and client before its first render, puts
the result in route context, sets `<html lang>`, and initializes
`I18nProvider`. This is required for SSR and hydration consistency; see the
[SSR and hydration guide](ssr-and-hydration.md#locale).

Do not introduce `localStorage` or another locale source. A language change
must go through `setLocale` from `useI18n()`: it writes the cookie, updates the
router context, invalidates route data, and updates `document.documentElement.lang`.

## Translating UI

Use `useI18n()` in React components:

```tsx
const { t } = useI18n();

return <Button>{t("save")}</Button>;
```

For route metadata and other code that cannot call hooks, create a translator
from the locale in route context:

```tsx
head: ({ match }) => ({
  meta: [{ title: `${createTranslator(match.context.locale)("settings")} · Coldbrew` }],
});
```

Add every visible UI string, including empty states, validation errors,
accessible names, titles, and document titles, to the dictionaries in
`apps/web/src/lib/i18n.tsx`. Do not choose copy with `locale === "ru"` in a
component or leave a fallback literal beside a translated string. This keeps
the translation catalog complete and makes missing translations a type error.

The English dictionary defines the translation contract. Add a key to `en`,
then add the same key to `ru`; `defineTranslations` rejects missing, extra, or
incompatibly typed Russian entries. Prefer descriptive, stable camelCase keys
that describe the UI meaning rather than an English sentence.

## Dynamic messages

Use a function entry when a message has variable content. Its argument shape
is part of the type-safe contract and must be identical in both dictionaries:

```tsx
// Dictionary
videoQueueBy: (({ slug }: { slug: string }) => `Video queue: ${slug}`,
  // Consumer
  t("videoQueueBy", { slug }));
```

Pass complete values instead of assembling translated fragments in a
component. This allows each locale to use its own word order, cases, and
punctuation. For quantities with language-specific grammar, add a dedicated
message function; do not concatenate a number and a translated unit.

## Formatting values

Use the formatters in `apps/web/src/lib/fmt.ts` for user-facing monetary
amounts and dates. They accept `Locale` and map it to the appropriate BCP 47
tag (`en-US` or `ru-RU`). Keep business values canonical and pass the locale
only at the presentation boundary.

```tsx
fmtAmount(video.queueAmount, queueCurrency, locale);
fmtDate(video.createdAt, locale);
```

Never infer a currency from the locale: queue currency belongs to the user and
a donation retains its original currency. Relative dates use the current time,
so do not render them during SSR unless the server and first client render
share a fixed time snapshot.

## Adding a language

When adding a locale, update all of these together:

1. `locales`, `Locale`, and `resolveLocale` in `lib/locale.ts`.
2. The complete translation dictionary and `messages` in `lib/i18n.tsx`.
3. The locale-to-language-tag mapping in `lib/fmt.ts`.
4. The language selector labels and flags in the root route.
5. Locale-resolution, translator, and formatter tests.
6. The SSR and hydration paths, including `<html lang>` and cookie fallback.

Run `just typecheck` and `just fmt` after changing the translation contract or
locale plumbing.
