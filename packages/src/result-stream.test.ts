import { delay } from "@lebedevna/delay";
import { describe, expect, it, vi } from "vitest";

import {
  createResultEventStream,
  fromFallibleAsyncIterator,
  mergeResultStreams,
  type ResultStream,
} from "./result-stream.js";

async function nextValue<T>(iterator: AsyncIterator<T>) {
  const result = await iterator.next();
  if (result.done === true) {
    throw new Error("Expected the result stream to yield a value.");
  }
  return result.value;
}

describe("result streams", () => {
  it("turns external iterator failures into results and closes once", async () => {
    const cleanup = vi.fn();
    const failure = { type: "external failure" as const };
    const iterator = fromFallibleAsyncIterator(
      () => ({
        next: async (): Promise<IteratorResult<never>> => await Promise.reject(failure),
        return: async (): Promise<IteratorResult<never>> => {
          cleanup();
          return { done: true, value: undefined };
        },
      }),
      () => failure,
      () => undefined,
    )[Symbol.asyncIterator]();

    expect((await nextValue(iterator))._unsafeUnwrapErr()).toBe(failure);
    expect(await iterator.next()).toEqual({ done: true, value: undefined });
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("cleans callback resources when the consumer returns", async () => {
    const cleanup = vi.fn();
    let streamSignal: AbortSignal | undefined;
    const iterator = createResultEventStream<string, never>((_sink, signal) => {
      streamSignal = signal;
      return cleanup;
    })[Symbol.asyncIterator]();
    const pending = iterator.next();
    await Promise.resolve();

    const returned = iterator.return?.();

    expect(streamSignal?.aborted).toBe(true);
    await Promise.all([pending, returned]);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("merges streams and cancels siblings after an error", async () => {
    let siblingSignal: AbortSignal | undefined;
    const failure = { type: "failed" as const };
    const first: ResultStream<string, typeof failure> = createResultEventStream(async (sink) => {
      await sink.emit("first");
      await sink.fail(failure);
    });
    const sibling: ResultStream<string, typeof failure> = createResultEventStream(
      (_sink, signal) => {
        siblingSignal = signal;
      },
    );
    const collected = [];

    for await (const $item of mergeResultStreams([first, sibling])) {
      collected.push($item);
    }

    expect(collected[0]?._unsafeUnwrap()).toBe("first");
    expect(collected[1]?._unsafeUnwrapErr()).toBe(failure);
    await delay(0);
    expect(siblingSignal?.aborted).toBe(true);
  });

  it("propagates iterator exceptions and cancels siblings", async () => {
    const failure = new Error("iterator failed");
    const failingCleanup = vi.fn(async () => ({ done: true as const, value: undefined }));
    const throwing: ResultStream<string, never> = {
      [Symbol.asyncIterator]() {
        return {
          next: async () => await Promise.reject(failure),
          return: failingCleanup,
        };
      },
    };
    let siblingSignal: AbortSignal | undefined;
    const siblingCleanup = vi.fn();
    const sibling = createResultEventStream<string, never>((_sink, signal) => {
      siblingSignal = signal;
      return siblingCleanup;
    });
    const iterator = mergeResultStreams([throwing, sibling])[Symbol.asyncIterator]();

    await expect(iterator.next()).rejects.toBe(failure);
    await delay(0);
    expect(siblingSignal?.aborted).toBe(true);
    expect(failingCleanup).toHaveBeenCalledOnce();
    expect(siblingCleanup).toHaveBeenCalledOnce();
  });

  it("closes constructed iterators when another iterator cannot be constructed", async () => {
    const failure = new Error("iterator construction failed");
    const cleanup = vi.fn(async () => ({ done: true as const, value: undefined }));
    const constructed: ResultStream<string, never> = {
      [Symbol.asyncIterator]() {
        return { next: async () => await new Promise<never>(() => undefined), return: cleanup };
      },
    };
    const throwing: ResultStream<string, never> = {
      [Symbol.asyncIterator]() {
        throw failure;
      },
    };
    const iterator = mergeResultStreams([constructed, throwing])[Symbol.asyncIterator]();

    await expect(iterator.next()).rejects.toBe(failure);
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
