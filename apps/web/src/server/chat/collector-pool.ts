import { propagateError } from "@coldbrew/packages/neverthrow/propagate-error.js";
import type { ResultStream } from "@coldbrew/packages/result-stream.js";
import { delay } from "@lebedevna/delay";
import { erro } from "@lebedevna/neverthrow-utils";
import type { ChatMessage, ChatSource, ChatSourceState, ChatStreamEvent } from "@web/lib/chat.js";
import { chatMessageKey, chatSourceKey } from "@web/lib/chat.js";
import Emittery from "emittery";
import { ok, Result, ResultAsync } from "neverthrow";

import type { ChatEventSource, ChatSourceFactory } from "./provider.js";

const BUFFER_SIZE = 200;
const COLLECTOR_RETRY_START_MS = 5_000;
const COLLECTOR_RETRY_MAX_MS = 60_000;

type CollectorSnapshot = Readonly<{
  state: ChatSourceState;
  detail?: string;
  messages: readonly ChatMessage[];
}>;

type CollectorRuntime = Readonly<{
  source: ChatSource;
  eventSource: ChatEventSource;
  controller: AbortController | null;
  graceController?: AbortController;
  events: Emittery<{ event: ChatStreamEvent }>;
  subscribers: number;
  snapshot: CollectorSnapshot;
}>;

type CollectorPoolRuntime = Readonly<{
  collectors: Map<string, CollectorRuntime>;
  gracePeriodMs: number;
}>;

export type ChatCollectorError = Readonly<{
  type: "stream unavailable";
  detail: string;
}>;

const initialSnapshot: CollectorSnapshot = { state: "connecting", messages: [] };

function streamUnavailable(detail: string, cause: unknown) {
  return erro.fmt({ type: "stream unavailable" as const, detail, cause });
}

function reduceSnapshot(snapshot: CollectorSnapshot, event: ChatStreamEvent): CollectorSnapshot {
  if (event.type === "connection_error") return snapshot;
  if (event.type === "state") {
    return {
      ...snapshot,
      state: event.state,
      ...(event.detail ? { detail: event.detail } : { detail: undefined }),
    };
  }
  const key = chatMessageKey(event.message);
  if (snapshot.messages.some((message) => chatMessageKey(message) === key)) return snapshot;
  return { ...snapshot, messages: [...snapshot.messages, event.message].slice(-BUFFER_SIZE) };
}

function snapshotEvents(source: ChatSource, snapshot: CollectorSnapshot): ChatStreamEvent[] {
  return [
    {
      type: "state",
      provider: source.provider,
      sourceIdentifier: source.sourceIdentifier,
      state: snapshot.state,
      ...(snapshot.detail ? { detail: snapshot.detail } : {}),
    },
    ...snapshot.messages.map((message) => ({ type: "message" as const, message })),
  ];
}

function replaceCollector(runtime: CollectorPoolRuntime, key: string, collector: CollectorRuntime) {
  runtime.collectors.set(key, collector);
}

async function publish(
  runtime: CollectorPoolRuntime,
  key: string,
  event: ChatStreamEvent,
): Promise<Result<void, ChatCollectorError>> {
  const collector = runtime.collectors.get(key);
  if (!collector) return ok(undefined);
  replaceCollector(runtime, key, {
    ...collector,
    snapshot: reduceSnapshot(collector.snapshot, event),
  });
  return await ResultAsync.fromPromise(
    collector.events.emit("event", event),
    (cause): ChatCollectorError => streamUnavailable("Could not publish a chat event", cause),
  );
}

async function collect(runtime: CollectorPoolRuntime, key: string) {
  const collector = runtime.collectors.get(key);
  if (!collector?.controller) return ok(undefined);
  const controller = collector.controller;
  const signal = controller.signal;
  let retryMs = COLLECTOR_RETRY_START_MS;

  while (!signal.aborted) {
    const $iterator = Result.fromThrowable(
      () => collector.eventSource.stream(signal)[Symbol.asyncIterator](),
      (cause): ChatCollectorError => streamUnavailable("Chat provider stream failed", cause),
    )();
    let attemptDetail: string | undefined;

    if ($iterator.isErr()) {
      attemptDetail = $iterator.error.detail;
    } else {
      const iterator = $iterator.value;
      while (!signal.aborted) {
        const $next = await ResultAsync.fromPromise(
          iterator.next(),
          (cause): ChatCollectorError => streamUnavailable("Chat provider stream failed", cause),
        );
        if ($next.isErr()) {
          attemptDetail = $next.error.detail;
          break;
        }
        if ($next.value.done) {
          attemptDetail = "Chat provider stream ended";
          break;
        }
        const event = $next.value.value.match(
          (value) => value,
          (error): ChatStreamEvent => ({
            type: "state",
            provider: error.provider,
            sourceIdentifier: error.sourceIdentifier,
            state: "error",
            detail: error.detail,
          }),
        );
        if (event.type === "message") retryMs = COLLECTOR_RETRY_START_MS;
        const $published = await publish(runtime, key, event);
        if ($published.isErr()) {
          attemptDetail = $published.error.detail;
          break;
        }
      }

      const $returned = iterator.return
        ? await ResultAsync.fromPromise(
            iterator.return(),
            (cause): ChatCollectorError =>
              streamUnavailable("Could not close the chat provider stream", cause),
          )
        : ok(undefined);
      if ($returned.isErr()) attemptDetail = $returned.error.detail;
    }

    if (signal.aborted) break;
    await publish(runtime, key, {
      type: "state",
      provider: collector.source.provider,
      sourceIdentifier: collector.source.sourceIdentifier,
      state: "error",
      detail: attemptDetail ?? "Chat provider stream ended",
    });
    await delay(retryMs, { signal });
    if (signal.aborted) break;
    retryMs = Math.min(retryMs * 2, COLLECTOR_RETRY_MAX_MS);
    await publish(runtime, key, {
      type: "state",
      provider: collector.source.provider,
      sourceIdentifier: collector.source.sourceIdentifier,
      state: "connecting",
    });
  }

  const current = runtime.collectors.get(key);
  if (current?.controller === controller) {
    if (current.subscribers === 0) runtime.collectors.delete(key);
    else replaceCollector(runtime, key, { ...current, controller: null });
  }
  return ok(undefined);
}

function createCollector(source: ChatSource, factory: ChatSourceFactory): CollectorRuntime {
  return {
    source,
    eventSource: factory.create(source.sourceIdentifier),
    controller: new AbortController(),
    events: new Emittery(),
    subscribers: 1,
    snapshot: initialSnapshot,
  };
}

function acquire(runtime: CollectorPoolRuntime, source: ChatSource, factory: ChatSourceFactory) {
  const key = chatSourceKey(source);
  const existing = runtime.collectors.get(key);
  if (!existing) {
    replaceCollector(runtime, key, createCollector(source, factory));
    void collect(runtime, key);
    return key;
  }
  existing.graceController?.abort();
  const shouldRestart = !existing.controller || existing.controller.signal.aborted;
  replaceCollector(runtime, key, {
    ...existing,
    controller: shouldRestart ? new AbortController() : existing.controller,
    graceController: undefined,
    subscribers: existing.subscribers + 1,
  });
  if (shouldRestart) void collect(runtime, key);
  return key;
}

async function stopAfterGrace(
  runtime: CollectorPoolRuntime,
  key: string,
  graceController: AbortController,
) {
  await delay(runtime.gracePeriodMs, { signal: graceController.signal });
  if (graceController.signal.aborted) return;
  const collector = runtime.collectors.get(key);
  if (collector?.graceController !== graceController || collector.subscribers !== 0) return;
  collector.controller?.abort();
  if (!collector.controller) runtime.collectors.delete(key);
}

function release(runtime: CollectorPoolRuntime, key: string) {
  const collector = runtime.collectors.get(key);
  if (!collector) return;
  const subscribers = Math.max(collector.subscribers - 1, 0);
  if (subscribers > 0) {
    replaceCollector(runtime, key, { ...collector, subscribers });
    return;
  }
  if (!collector.controller) {
    runtime.collectors.delete(key);
    return;
  }
  const graceController = new AbortController();
  replaceCollector(runtime, key, { ...collector, graceController, subscribers });
  void stopAfterGrace(runtime, key, graceController);
}

async function* streamCollector(
  runtime: CollectorPoolRuntime,
  source: ChatSource,
  factory: ChatSourceFactory,
  signal: AbortSignal,
): ResultStream<ChatStreamEvent, ChatCollectorError> {
  if (signal.aborted) return;
  const key = acquire(runtime, source, factory);
  const collector = runtime.collectors.get(key);
  if (!collector) {
    yield erro({ type: "stream unavailable", detail: "Chat collector is unavailable" });
    return;
  }
  const iterator = collector.events.events("event", { signal });
  const snapshot = runtime.collectors.get(key)?.snapshot ?? initialSnapshot;
  try {
    for (const event of snapshotEvents(source, snapshot)) yield ok(event);
    while (!signal.aborted) {
      const $next = await ResultAsync.fromPromise(
        iterator.next(),
        (cause): ChatCollectorError =>
          streamUnavailable("Could not read a chat collector event", cause),
      );
      if ($next.isErr()) {
        if (!signal.aborted) yield propagateError($next);
        return;
      }
      if ($next.value.done) return;
      yield ok($next.value.value.data);
    }
  } finally {
    if (iterator.return) {
      await ResultAsync.fromPromise(
        iterator.return(),
        (cause): ChatCollectorError =>
          streamUnavailable("Could not close a chat collector subscription", cause),
      );
    }
    release(runtime, key);
  }
}

export class ChatCollectorPool {
  private readonly runtime: CollectorPoolRuntime;

  constructor(gracePeriodMs: number) {
    this.runtime = { collectors: new Map(), gracePeriodMs };
  }

  stream(source: ChatSource, factory: ChatSourceFactory, signal: AbortSignal) {
    return streamCollector(this.runtime, source, factory, signal);
  }
}
