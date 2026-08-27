---
name: coldbrew-neverthrow-style
description: "Write and review Coldbrew code that uses Neverthrow, makes HTTP requests, or exposes long-running Result streams, including safeFetch, JSON validation, error propagation, and callback adaptation."
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
  .andThen((value) => validate(value, ResponseSchema));
```

## Creating errors

- Always create `Err` results with `erro` from `@lebedevna/neverthrow-utils`. Do not import or use `err` from `neverthrow`.
- Use `erro.fmt` only when a formatted error object is needed without wrapping it in a `Result`.
- After an `isErr()` check, propagate the existing `Result` directly with `return $result` or `yield $result`. Do not recreate it with `erro($result.error)`.
- If Neverthrow's retained success generic makes an otherwise compatible `Err` fail typechecking, use `propagateError` from `@coldbrew/packages/neverthrow/propagate-error.js`. It widens only the phantom success type and returns the same `Err` instance.
- Narrow HTTP and transport errors by their structured discriminants and fields. Do not infer an HTTP status or error kind from message text when structured data is available.
- Create a new `erro({ cause: $result.error })` only when this module deliberately translates an upstream error into its own error contract at a seam. Otherwise propagate the original Result.

```ts
import { erro } from "@lebedevna/neverthrow-utils";

if ($response.isErr()) {
  return erro({ type: "request failed", cause: $response.error });
}
```

## Result variable names

- Variables of types `Result` and `ResultAsync` must start with `$`.

## Failure boundary

- Use `Result` for expected failures from foreign HTTP APIs, WebSockets, gRPC, generated clients, event iterators, subscriptions, and long-running workers.
- Convert thrown exceptions from third-party or generated code at the nearest application seam. Do not edit generated files to change their error model.
- Do not turn SQL failures, internal Zod/schema invariants, programmer errors, or framework fail-fast errors into expected `Result` values merely to keep a stream alive.

## `safeTry`

- Use `safeTry` when several `Result` or `ResultAsync` operations must run sequentially and `yield*` can replace repeated error checks and early returns.
- `safeTry` is especially useful when a workflow branches or retries between fallible steps. Keep a direct `.andThen()` chain when the flow is purely linear.

```ts
return safeTry(async function* () {
  const response = yield* safeFetch(url);
  const value = yield* parseJson(response);

  return validate(value, ResponseSchema);
});
```

## Long-running Result streams

- Prefer a deep module that owns callbacks, transport, retries, cancellation, and mutable runtime resources while exposing `AsyncIterable<Result<T, E>>` through the `ResultStream<T, E>` alias.
- Do not expose callbacks as the public application interface for a long-running source. Keep them inside the adapter for a third-party callback API.
- Use `createResultEventStream` for callback or event-emitter sources, `fromFallibleAsyncIterator` for iterators whose open/read/close operations can fail, and `mergeResultStreams` to fan multiple Result streams into one.
- Treat cancellation as normal completion. It must close owned resources and must not emit a user-visible error.
- The module that starts a long-running operation owns and retains its `AbortController`; callers provide only a parent `AbortSignal`. Do not pass a fresh, unretained `new AbortController().signal`. Iterator `.return()` must abort owned work and await idempotent cleanup.
