import { createAbortableStream } from "@coldbrew/packages/create-abortable-stream.js";
import { mergeResultStreams, type ResultStream } from "@coldbrew/packages/result-stream.js";
import { delay } from "@lebedevna/delay";
import { erro } from "@lebedevna/neverthrow-utils";
import type { ChatProvider, ChatSource, ChatStreamEvent } from "@web/lib/chat.js";
import { ok, type Result } from "neverthrow";

import { createChatCollectorPool, type ChatCollectorError } from "./collector-pool.js";
import type { ChatProviderAdapter } from "./provider.js";
import { youtubeChatProvider } from "./youtube.js";

const GRACE_PERIOD_MS = 90_000;
const MAX_SESSIONS = 3;

type RegistryRuntime = Readonly<{
  sessionCounts: Map<string, number>;
}>;

export type ChatRegistryError = Readonly<{ type: "session limit" }> | ChatCollectorError;

export type RegistryEvent = Result<ChatStreamEvent, ChatRegistryError>;

const activeProviders: ReadonlyMap<ChatProvider, ChatProviderAdapter> = new Map([
  [youtubeChatProvider.provider, youtubeChatProvider],
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
  providers: ReadonlyMap<ChatProvider, ChatProviderAdapter>,
  sessionKey: string,
  sources: readonly ChatSource[],
  signal: AbortSignal,
  collectorPool: ReturnType<typeof createChatCollectorPool>,
): ResultStream<ChatStreamEvent, ChatRegistryError> {
  const $started = startSession(runtime, sessionKey);
  if ($started.isErr()) {
    yield $started;
    return;
  }
  const controller = new AbortController();
  const streamSignal = AbortSignal.any([signal, controller.signal]);
  const streams = sources.flatMap((source) => {
    const provider = providers.get(source.provider);
    return provider ? [collectorPool.stream(source, provider, streamSignal)] : [];
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

export function createChatCollectorRegistry(
  providers: readonly ChatProviderAdapter[],
  options: Readonly<{ gracePeriodMs?: number }> = {},
) {
  const runtime: RegistryRuntime = {
    sessionCounts: new Map(),
  };
  const collectorPool = createChatCollectorPool(options.gracePeriodMs ?? GRACE_PERIOD_MS);
  const providerMap: ReadonlyMap<ChatProvider, ChatProviderAdapter> = new Map(
    providers.map((provider) => [provider.provider, provider]),
  );
  return {
    stream(
      sessionKey: string,
      sources: readonly ChatSource[],
      parentSignal?: AbortSignal,
    ): ResultStream<ChatStreamEvent, ChatRegistryError> {
      return createAbortableStream(
        (signal) =>
          streamRegistry(runtime, providerMap, sessionKey, sources, signal, collectorPool),
        parentSignal,
      );
    },
  };
}

export const chatCollectorRegistry = createChatCollectorRegistry([...activeProviders.values()]);
