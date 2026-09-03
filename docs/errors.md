# TypeScript error handling

Use native exceptions and rejected promises for failures. Do not introduce `Result` wrappers or a
parallel result abstraction.

## Foreign boundaries

- Convert transport, protocol, decoding, and validation failures into a typed `Error` subclass at
  the nearest application seam.
- Preserve the original failure with `cause`. Keep structured fields such as an HTTP status instead
  of parsing message text.
- Use `requestText`, `requestJson`, and `parseJson` from `@coldbrew/packages/http.js` for HTTP and
  JSON responses. They check the HTTP status and validate decoded data with Zod.
- Normalize untrusted input once. Downstream code receives the validated domain value.

## Catching errors

- Catch only where the caller can recover, add useful context, or translate the error into another
  public contract.
- tRPC procedures translate known service errors into `TRPCError` codes and attach the original
  error as `cause`. Unknown errors continue to the framework's internal-error handler.
- Internal invariant failures, database failures, and programmer errors fail fast unless that layer
  has a concrete recovery policy.

## Streams and cancellation

- Expose long-running sources as `AsyncIterable<T>`: yield values and throw a typed error when the
  stream fails.
- Treat abort-driven cancellation as normal completion. Close owned readers, sockets, and other
  resources in `finally` blocks.
- The lifecycle owner supplies an `AbortSignal`; adapters use it directly and still own resource
  cleanup in `finally` blocks. A tRPC subscription receives its signal from tRPC.
