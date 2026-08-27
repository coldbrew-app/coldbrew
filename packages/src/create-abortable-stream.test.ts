import { delay } from "@lebedevna/delay";
import { describe, expect, it } from "vitest";

import { createAbortableStream } from "./create-abortable-stream.js";

describe("createAbortableStream", () => {
  it("aborts pending work before returning the iterator", async () => {
    let streamSignal: AbortSignal | undefined;
    const iterator = createAbortableStream(async function* (signal) {
      streamSignal = signal;
      await delay(60_000, { signal });
    })[Symbol.asyncIterator]();
    const pending = iterator.next();
    await Promise.resolve();

    const returned = iterator.return?.();

    expect(streamSignal?.aborted).toBe(true);
    await Promise.all([pending, returned]);
  });

  it("combines parent cancellation with iterator ownership", async () => {
    const parent = new AbortController();
    let streamSignal: AbortSignal | undefined;
    const iterator = createAbortableStream(async function* (signal) {
      streamSignal = signal;
      await delay(60_000, { signal });
    }, parent.signal)[Symbol.asyncIterator]();
    const pending = iterator.next();
    await Promise.resolve();

    parent.abort();

    expect(streamSignal?.aborted).toBe(true);
    await pending;
  });

  it("creates independent cancellation scopes for each iterator", async () => {
    const signals: AbortSignal[] = [];
    const stream = createAbortableStream(async function* (signal) {
      signals.push(signal);
      await delay(60_000, { signal });
    });
    const first = stream[Symbol.asyncIterator]();
    const second = stream[Symbol.asyncIterator]();
    const firstPending = first.next();
    const secondPending = second.next();
    await Promise.resolve();

    const firstReturned = first.return?.();

    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    await Promise.all([firstPending, firstReturned]);
    const secondReturned = second.return?.();
    await Promise.all([secondPending, secondReturned]);
  });

  it("releases its cancellation scope after natural completion", async () => {
    let streamSignal: AbortSignal | undefined;
    const iterator = createAbortableStream(async function* (signal) {
      streamSignal = signal;
      yield "message";
    })[Symbol.asyncIterator]();

    expect(await iterator.next()).toEqual({ done: false, value: "message" });
    expect(streamSignal?.aborted).toBe(false);
    expect(await iterator.next()).toEqual({ done: true, value: undefined });
    expect(streamSignal?.aborted).toBe(true);
  });

  it("releases its cancellation scope when the source rejects", async () => {
    const failure = new Error("stream failed");
    let streamSignal: AbortSignal | undefined;
    const iterator = createAbortableStream((signal) => {
      streamSignal = signal;
      return {
        [Symbol.asyncIterator]() {
          return {
            next: () => Promise.reject(failure),
          };
        },
      };
    })[Symbol.asyncIterator]();

    await expect(iterator.next()).rejects.toBe(failure);
    expect(streamSignal?.aborted).toBe(true);
  });
});
