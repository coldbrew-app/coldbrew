import { erro } from "@lebedevna/neverthrow-utils";
import Emittery from "emittery";
import { ok, Result, ResultAsync, type Result as NeverthrowResult } from "neverthrow";

import { createAbortableStream } from "./create-abortable-stream.js";
import { propagateError } from "./neverthrow/propagate-error.js";

type TypedError = Readonly<{ type: string }>;

export type ResultStream<T, E extends TypedError> = AsyncIterable<NeverthrowResult<T, E>>;

export type ResultStreamSink<T, E extends TypedError> = Readonly<{
  emit(value: T): Promise<void>;
  fail(error: E): Promise<void>;
  end(): Promise<void>;
}>;

type Cleanup = () => void | Promise<void>;

export function createResultEventStream<T, E extends TypedError>(
  register: (
    sink: ResultStreamSink<T, E>,
    signal: AbortSignal,
  ) => Cleanup | void | Promise<Cleanup | void>,
  parentSignal?: AbortSignal,
): ResultStream<T, E> {
  return createAbortableStream(async function* (signal) {
    if (signal.aborted) return;

    const events = new Emittery<{
      event: NeverthrowResult<T, E>;
      end: undefined;
    }>();
    const iterator = events.events(["event", "end"], { signal });
    const workController = new AbortController();
    const workSignal = AbortSignal.any([signal, workController.signal]);
    let ended = false;
    const end = async () => {
      if (ended) return;
      ended = true;
      await events.emit("end");
    };
    const sink: ResultStreamSink<T, E> = {
      emit: async (value) => {
        if (!ended && !workSignal.aborted) await events.emit("event", ok(value));
      },
      fail: async (error) => {
        if (ended || workSignal.aborted) return;
        await events.emit("event", erro(error));
        await end();
      },
      end,
    };
    const cleanup = await register(sink, workSignal);

    try {
      for await (const event of iterator) {
        if (event.name === "end") return;
        yield event.data;
      }
    } finally {
      workController.abort();
      await iterator.return?.();
      await cleanup?.();
    }
  }, parentSignal);
}

export function fromFallibleAsyncIterator<T, E extends TypedError>(
  open: (signal: AbortSignal) => AsyncIterator<T>,
  toError: (operation: "open" | "read" | "close", cause: unknown, signal: AbortSignal) => E,
  onCleanupError: (error: E) => void,
  parentSignal?: AbortSignal,
): ResultStream<T, E> {
  return createAbortableStream(async function* (signal) {
    const $iterator = Result.fromThrowable(
      () => open(signal),
      (cause) => toError("open", cause, signal),
    )();
    if ($iterator.isErr()) {
      yield propagateError($iterator);
      return;
    }

    const iterator = $iterator.value;
    try {
      while (!signal.aborted) {
        const $next = await ResultAsync.fromPromise(iterator.next(), (cause) =>
          toError("read", cause, signal),
        );
        if ($next.isErr()) {
          if (!signal.aborted) yield propagateError($next);
          return;
        }
        if ($next.value.done) return;
        yield ok($next.value.value);
      }
    } finally {
      if (iterator.return) {
        const $closed = await ResultAsync.fromPromise(iterator.return(), (cause) =>
          toError("close", cause, signal),
        );
        if ($closed.isErr()) onCleanupError($closed.error);
      }
    }
  }, parentSignal);
}

export function mergeResultStreams<T, E extends TypedError>(
  streams: readonly ResultStream<T, E>[],
  parentSignal?: AbortSignal,
): ResultStream<T, E> {
  return createResultEventStream((sink, signal) => {
    if (streams.length === 0) {
      void sink.end();
      return;
    }

    let remaining = streams.length;
    const iterators = streams.map((stream) => stream[Symbol.asyncIterator]());
    const tasks = iterators.map(async (iterator) => {
      try {
        while (!signal.aborted) {
          const next = await iterator.next();
          if (next.done) return;
          const $item = next.value;
          if ($item.isErr()) {
            await sink.fail($item.error);
            return;
          }
          await sink.emit($item.value);
        }
      } finally {
        remaining -= 1;
        if (remaining === 0) await sink.end();
      }
    });

    return async () => {
      await Promise.allSettled(iterators.map(async (iterator) => await iterator.return?.()));
      await Promise.allSettled(tasks);
    };
  }, parentSignal);
}
