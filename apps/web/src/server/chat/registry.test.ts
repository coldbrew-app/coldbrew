import { delay } from "@lebedevna/delay";
import { erro } from "@lebedevna/neverthrow-utils";
import type { ChatMessage, ChatSource } from "@web/lib/chat.js";
import { ok } from "neverthrow";
import { describe, expect, it } from "vitest";

import type { ChatProviderAdapter } from "./provider.js";
import { createChatCollectorRegistry, type RegistryEvent } from "./registry.js";

const TEST_WAIT_MS = 60_000;

const source: ChatSource = {
  provider: "youtube",
  sourceIdentifier: "video-id",
  sourceUrl: "https://youtu.be/video-id",
};

async function nextMessage(iterator: AsyncIterator<RegistryEvent>) {
  for (let index = 0; index < 6; index += 1) {
    const next = await iterator.next();
    if (next.done || next.value.isErr()) continue;
    if (next.value.value.type === "message") return next.value.value.message;
  }
  throw new Error("Expected a chat message");
}

async function nextErrorState(iterator: AsyncIterator<RegistryEvent>) {
  for (let index = 0; index < 6; index += 1) {
    const next = await iterator.next();
    if (next.done || next.value.isErr()) continue;
    const event = next.value.value;
    if (event.type === "state" && event.state === "error") return event;
  }
  throw new Error("Expected a source error state");
}

function message(id: string): ChatMessage {
  return {
    id,
    provider: "youtube",
    sourceIdentifier: "video-id",
    author: "Viewer",
    text: id,
    occurredAt: new Date("2026-08-27T12:00:00Z"),
  };
}

describe("chat collector registry", () => {
  it("shares one collector and replays its buffered messages", async () => {
    let starts = 0;
    const provider: ChatProviderAdapter = {
      provider: "youtube",
      async *stream(sourceIdentifier, signal) {
        starts += 1;
        yield ok({
          type: "message",
          message: {
            id: "message-1",
            provider: "youtube",
            sourceIdentifier,
            author: "Viewer",
            text: "Hello",
            occurredAt: new Date("2026-08-27T12:00:00Z"),
          },
        });
        await delay(TEST_WAIT_MS, { signal });
      },
    };
    const registry = createChatCollectorRegistry([provider]);
    const firstController = new AbortController();
    const first = registry
      .stream("session-1", [source], firstController.signal)
      [Symbol.asyncIterator]();

    await expect(nextMessage(first)).resolves.toMatchObject({ id: "message-1" });

    const second = registry.stream("session-2", [source])[Symbol.asyncIterator]();
    await expect(nextMessage(second)).resolves.toMatchObject({ id: "message-1" });
    expect(starts).toBe(1);

    firstController.abort();
    await first.return?.();
    await second.return?.();
  });

  it("limits concurrent streams for the same session", async () => {
    const provider: ChatProviderAdapter = {
      provider: "youtube",
      async *stream(_sourceIdentifier, signal) {
        await delay(TEST_WAIT_MS, { signal });
      },
    };
    const registry = createChatCollectorRegistry([provider]);
    const controllers = Array.from({ length: 4 }, () => new AbortController());
    const streams = controllers.map((controller) =>
      registry.stream("same-session", [], controller.signal)[Symbol.asyncIterator](),
    );
    const pending = streams.slice(0, 3).map((stream) => stream.next());

    const limited = await streams[3]!.next();
    expect(limited.done).toBe(false);
    if (!limited.done) {
      expect(limited.value.isErr()).toBe(true);
      if (limited.value.isErr()) expect(limited.value.error.type).toBe("session limit");
    }

    for (const controller of controllers) controller.abort();
    await Promise.allSettled(pending);
    await Promise.all(streams.map(async (stream) => await stream.return?.()));
  });

  it("turns provider errors into source state without rejecting the session", async () => {
    const provider: ChatProviderAdapter = {
      provider: "youtube",
      async *stream(sourceIdentifier, signal) {
        yield erro({
          type: "chat provider error",
          provider: "youtube",
          sourceIdentifier,
          detail: "YouTube connection failed",
        });
        await delay(TEST_WAIT_MS, { signal });
      },
    };
    const registry = createChatCollectorRegistry([provider]);
    const controller = new AbortController();
    const iterator = registry
      .stream("session", [source], controller.signal)
      [Symbol.asyncIterator]();

    await expect(nextErrorState(iterator)).resolves.toMatchObject({
      provider: "youtube",
      sourceIdentifier: "video-id",
      detail: "YouTube connection failed",
    });

    controller.abort();
    await iterator.return?.();
  });

  it("starts a new provider run when a subscriber arrives as grace aborts", async () => {
    let starts = 0;
    const provider: ChatProviderAdapter = {
      provider: "youtube",
      async *stream(sourceIdentifier, signal) {
        starts += 1;
        yield ok({
          type: "message",
          message: { ...message(`run-${starts}`), sourceIdentifier },
        });
        await delay(TEST_WAIT_MS, { signal });
        if (signal?.aborted) await delay(50);
      },
    };
    const registry = createChatCollectorRegistry([provider], { gracePeriodMs: 0 });
    const firstController = new AbortController();
    const first = registry
      .stream("session-1", [source], firstController.signal)
      [Symbol.asyncIterator]();
    await expect(nextMessage(first)).resolves.toMatchObject({ id: "run-1" });
    firstController.abort();
    await first.return?.();

    await delay(5);
    const secondController = new AbortController();
    const second = registry
      .stream("session-2", [source], secondController.signal)
      [Symbol.asyncIterator]();
    await expect(nextMessage(second)).resolves.toMatchObject({ id: "run-1" });
    await expect(nextMessage(second)).resolves.toMatchObject({ id: "run-2" });
    expect(starts).toBe(2);

    secondController.abort();
    await second.return?.();
  });
});
