import { erro } from "@lebedevna/neverthrow-utils";
import Emittery from "emittery";
import { ok, Result, ResultAsync, type Result as NeverthrowResult } from "neverthrow";

import { createAbortableStream } from "./create-abortable-stream.js";
import { propagateError } from "./neverthrow/propagate-error.js";

export type EventSourceError = Readonly<{ type: string }>;

export type ResultStream<T, E extends EventSourceError> = AsyncIterable<NeverthrowResult<T, E>>;

export interface EventSource<T, E extends EventSourceError> {
  stream(parentSignal?: AbortSignal): ResultStream<T, E>;
}

export interface EventSourceFactory<TInput, T, E extends EventSourceError> {
  create(input: TInput): EventSource<T, E>;
}

export type ResultStreamSink<T, E extends EventSourceError> = Readonly<{
  emit(value: T): Promise<void>;
  fail(error: E): Promise<void>;
  end(): Promise<void>;
}>;

type Cleanup = () => void | Promise<void>;

export function createResultEventStream<T, E extends EventSourceError>(
  register: (
    sink: ResultStreamSink<T, E>,
    signal: AbortSignal,
  ) => Cleanup | void | Promise<Cleanup | void>,
  parentSignal?: AbortSignal,
): ResultStream<T, E> {
  return createAbortableStream(async function* (signal) {
    if (signal.aborted) {
      return;
    }

    const events = new Emittery<{
      event: NeverthrowResult<T, E>;
      end: undefined;
    }>();
    const iterator = events.events(["event", "end"], { signal });
    const workController = new AbortController();
    const workSignal = AbortSignal.any([signal, workController.signal]);
    let ended = false;
    const end = async () => {
      if (ended) {
        return;
      }
      ended = true;
      await events.emit("end");
    };
    const sink: ResultStreamSink<T, E> = {
      emit: async (value) => {
        if (!ended && !workSignal.aborted) {
          await events.emit("event", ok(value));
        }
      },
      fail: async (error) => {
        if (ended || workSignal.aborted) {
          return;
        }
        await events.emit("event", erro(error));
        await end();
      },
      end,
    };
    const cleanup = await register(sink, workSignal);

    try {
      for await (const event of iterator) {
        if (event.name === "end") {
          return;
        }
        yield event.data;
      }
    } finally {
      workController.abort();
      await iterator.return?.();
      await cleanup?.();
    }
  }, parentSignal);
}

export function fromFallibleAsyncIterator<T, E extends EventSourceError>(
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
          if (!signal.aborted) {
            yield propagateError($next);
          }
          return;
        }
        if ($next.value.done === true) {
          return;
        }
        yield ok($next.value.value);
      }
    } finally {
      if (iterator.return) {
        const $closed = await ResultAsync.fromPromise(iterator.return(), (cause) =>
          toError("close", cause, signal),
        );
        if ($closed.isErr()) {
          onCleanupError($closed.error);
        }
      }
    }
  }, parentSignal);
}

export function mergeResultStreams<T, E extends EventSourceError>(
  streams: readonly ResultStream<T, E>[],
  parentSignal?: AbortSignal,
): ResultStream<T, E> {
  return createAbortableStream(async function* (signal) {
    if (signal.aborted) {
      return;
    }
    const iterators: AsyncIterator<NeverthrowResult<T, E>>[] = [];
    const read = async (index: number) => ({ index, result: await iterators[index].next() });
    const pending = new Map<number, ReturnType<typeof read>>();
    let closed = false;
    const close = async () => {
      if (closed) {
        return;
      }
      closed = true;
      await Promise.allSettled(iterators.map(async (iterator) => await iterator.return?.()));
      await Promise.allSettled(pending.values());
    };

    try {
      for (const stream of streams) {
        iterators.push(stream[Symbol.asyncIterator]());
      }
      for (const [index] of iterators.entries()) {
        pending.set(index, read(index));
      }

      while (!signal.aborted && pending.size > 0) {
        const { index, result } = await Promise.race(pending.values());
        if (result.done === true) {
          pending.delete(index);
          continue;
        }

        const $item = result.value;
        if ($item.isErr()) {
          pending.delete(index);
          await close();
        } else {
          pending.set(index, read(index));
        }

        yield $item;
        if ($item.isErr()) {
          return;
        }
      }
    } finally {
      await close();
    }
  }, parentSignal);
}
