import { delay } from "@lebedevna/delay";
import { describe, expect, it, vi } from "vitest";

import {
  createResultEventStream,
  fromFallibleAsyncIterator,
  mergeResultStreams,
  type ResultStream,
} from "./result-stream.js";

describe("result streams", () => {
  it("turns external iterator failures into results and closes once", async () => {
    const cleanup = vi.fn();
    const failure = { type: "external failure" as const };
    const iterator = fromFallibleAsyncIterator(
      () => ({ next: async () => await Promise.reject(failure), return: async () => cleanup() }),
      () => failure,
      () => undefined,
    )[Symbol.asyncIterator]();

    expect((await iterator.next()).value?._unsafeUnwrapErr()).toBe(failure);
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

    for await (const $item of mergeResultStreams([first, sibling])) collected.push($item);

    expect(collected[0]?._unsafeUnwrap()).toBe("first");
    expect(collected[1]?._unsafeUnwrapErr()).toBe(failure);
    await delay(0);
    expect(siblingSignal?.aborted).toBe(true);
  });
});
