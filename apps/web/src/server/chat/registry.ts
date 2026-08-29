import { createAbortableStream } from "@coldbrew/packages/create-abortable-stream.js";
import { mergeResultStreams, type ResultStream } from "@coldbrew/packages/result-stream.js";
import { delay } from "@lebedevna/delay";
import { erro } from "@lebedevna/neverthrow-utils";
import type { ChatProvider, ChatSource, ChatStreamEvent } from "@web/lib/chat.js";
import { ok, type Result } from "neverthrow";

import { ChatCollectorPool, type ChatCollectorError } from "./collector-pool.js";
import type { ChatSourceFactory } from "./provider.js";
import { youtubeChatSourceFactory } from "./youtube.js";

const GRACE_PERIOD_MS = 90_000;
const MAX_SESSIONS = 3;

type RegistryRuntime = Readonly<{
  sessionCounts: Map<string, number>;
}>;

export type ChatRegistryError = Readonly<{ type: "session limit" }> | ChatCollectorError;

export type RegistryEvent = Result<ChatStreamEvent, ChatRegistryError>;

const activeSourceFactories: ReadonlyMap<ChatProvider, ChatSourceFactory> = new Map([
  [youtubeChatSourceFactory.provider, youtubeChatSourceFactory],
]);

function startSession(runtime: RegistryRuntime, sessionKey: string) {
  const count = runtime.sessionCounts.get(sessionKey) ?? 0;
  if (count >= MAX_SESSIONS) return erro({ type: "session limit" });
  runtime.sessionCounts.set(sessionKey, count + 1);
  return ok(undefined);
}

function finishSession(runtime: RegistryRuntime, sessionKey: string) {
  const count = (runtime.sessionCounts.get(sessionKey) ?? 1) - 1;
  if (count === 0) runtime.sessionCounts.delete(sessionKey);
  else runtime.sessionCounts.set(sessionKey, count);
}

async function* streamRegistry(
  runtime: RegistryRuntime,
  sourceFactories: ReadonlyMap<ChatProvider, ChatSourceFactory>,
  sessionKey: string,
  sources: readonly ChatSource[],
  signal: AbortSignal,
  collectorPool: ChatCollectorPool,
): ResultStream<ChatStreamEvent, ChatRegistryError> {
  const $started = startSession(runtime, sessionKey);
  if ($started.isErr()) {
    yield $started;
    return;
  }
  const controller = new AbortController();
  const streamSignal = AbortSignal.any([signal, controller.signal]);
  const streams = sources.flatMap((source) => {
    const factory = sourceFactories.get(source.provider);
    return factory ? [collectorPool.stream(source, factory, streamSignal)] : [];
  });
  try {
    if (streams.length === 0) {
      while (!streamSignal.aborted) await delay(60_000, { signal: streamSignal });
      return;
    }
    for await (const $event of mergeResultStreams(streams, streamSignal)) {
      yield $event;
      if ($event.isErr()) return;
    }
  } finally {
    controller.abort();
    finishSession(runtime, sessionKey);
  }
}

export class ChatCollectorRegistry {
  private readonly runtime: RegistryRuntime;
  private readonly collectorPool: ChatCollectorPool;
  private readonly sourceFactories: ReadonlyMap<ChatProvider, ChatSourceFactory>;

  constructor(
    sourceFactories: readonly ChatSourceFactory[],
    options: Readonly<{ gracePeriodMs?: number }> = {},
  ) {
    this.runtime = { sessionCounts: new Map() };
    this.collectorPool = new ChatCollectorPool(options.gracePeriodMs ?? GRACE_PERIOD_MS);
    this.sourceFactories = new Map(sourceFactories.map((factory) => [factory.provider, factory]));
  }

  stream(
    sessionKey: string,
    sources: readonly ChatSource[],
    parentSignal?: AbortSignal,
  ): ResultStream<ChatStreamEvent, ChatRegistryError> {
    return createAbortableStream(
      (signal) =>
        streamRegistry(
          this.runtime,
          this.sourceFactories,
          sessionKey,
          sources,
          signal,
          this.collectorPool,
        ),
      parentSignal,
    );
  }
}

export const chatCollectorRegistry = new ChatCollectorRegistry([...activeSourceFactories.values()]);
