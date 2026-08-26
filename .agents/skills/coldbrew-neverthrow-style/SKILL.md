---
name: coldbrew-neverthrow-style
description: "Write and review Coldbrew code that uses Neverthrow or makes HTTP requests, including safeFetch error handling and JSON parsing."
---

# Coldbrew Neverthrow Style

Apply this skill whenever creating, editing, or reviewing `Result`, `ResultAsync`, or application HTTP requests.

## HTTP requests

- Use `safeFetch` from `@lebedevna/neverthrow-utils` for every application HTTP request. Do not call `fetch()` directly or wrap it with `ResultAsync.fromPromise()`.
- `safeFetch` returns a `ResultAsync<string, SafeFetchError>`. A successful 2xx response is `Ok` with its text body; non-2xx responses and transport failures are `Err` values.
- For JSON responses, chain `parseJson` and `validate` from `@lebedevna/neverthrow-utils` with `.andThen()`. Do not split the stages into manual `isOk()` checks or call Zod `.parse()`/`.safeParse()` directly.
- Native `fetch` is allowed for infrastructure healthchecks in `compose.yaml` and when implementing a fetch-compatible library callback whose contract requires returning a raw `Response`, such as the callback passed to a tRPC HTTP link. `safeFetch` consumes the response body and cannot satisfy the latter contract.

```ts
const $response = await safeFetch(url, { signal })
  .andThen(parseJson)
  .andThen((value) => validate(ResponseSchema, value));
```

## Result variable names

- Variables of types `Result` and `ResultAsync` must start with `$`.

## `safeTry`

- Use `safeTry` when several `Result` or `ResultAsync` operations must run sequentially and `yield*` can replace repeated error checks and early returns.
- `safeTry` is especially useful when a workflow branches or retries between fallible steps. Keep a direct `.andThen()` chain when the flow is purely linear.

```ts
return safeTry(async function* () {
  const response = yield* safeFetch(url);
  const value = yield* parseJson(response);

  return validate(ResponseSchema, value);
});
```
