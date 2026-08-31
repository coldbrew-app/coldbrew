import { randomUUID } from "node:crypto";

import type { ChatProvider, ChatSourceId, ChatStreamEvent } from "@coldbrew/packages/chat.js";
import { logger } from "@coldbrew/packages/logger.js";
import { delay } from "@lebedevna/delay";

import type { ChatEventBroker } from "./chat-application.js";
import type { CollectorLease } from "./nats.js";
import type { ChatProviderAdapter, ConnectedChatSource } from "./provider.js";

const RECONCILE_INTERVAL_MS = 10_000;
const LEASE_RETRY_MS = 5_000;
const STREAM_RETRY_MS = 2_000;

type OwnedConnectedSource = Readonly<{
  userId: number;
  connectedSource: ConnectedChatSource;
}>;

export interface ChatCollectorStore {
  getAllEnabledSources(): Promise<readonly OwnedConnectedSource[]>;
}

export interface ChatCollectorRefreshControl {
  refreshes(signal: AbortSignal): AsyncIterable<ChatSourceId>;
}

export interface ChatCollectorLeases {
  acquire(key: string, owner: string): Promise<CollectorLease | null>;
}

function eventKey(event: ChatStreamEvent) {
  if (event.type === "message") return `message:${event.message.sourceId}:${event.message.id}`;
  if (event.type === "message_deleted") {
    return `deleted:${event.sourceId}:${event.messageId}`;
  }
  return `${event.type}:${event.type === "state" ? event.sourceId : "connection"}:${randomUUID()}`;
}

async function collectSource(
  ownedSource: OwnedConnectedSource,
  provider: ChatProviderAdapter,
  broker: ChatEventBroker,
  leases: ChatCollectorLeases,
  serviceOwner: string,
  signal: AbortSignal,
) {
  const { userId, connectedSource } = ownedSource;
  const { sourceId } = connectedSource.source;

  while (!signal.aborted) {
    const lease = await leases.acquire(sourceId, serviceOwner);
    if (!lease) {
      await delay(LEASE_RETRY_MS, { signal });
      continue;
    }

    const leaseController = new AbortController();
    const collectionSignal = AbortSignal.any([signal, leaseController.signal]);
    const maintaining = lease.maintain(collectionSignal).catch((cause: unknown) => {
      if (!collectionSignal.aborted) logger.error({ cause, sourceId }, "Chat collector lease lost");
      leaseController.abort();
    });

    try {
      for await (const $event of provider.stream(connectedSource, collectionSignal)) {
        if ($event.isErr()) {
          await broker.publish(
            userId,
            {
              type: "state",
              sourceId,
              state: "error",
              detail: $event.error.detail,
            },
            `error:${sourceId}:${randomUUID()}`,
          );
          continue;
        }
        await broker.publish(userId, $event.value, eventKey($event.value));
      }
    } catch (cause) {
      if (!collectionSignal.aborted) logger.error({ cause, sourceId }, "Chat collector failed");
    } finally {
      leaseController.abort();
      await maintaining;
      await lease.release().catch((cause: unknown) => {
        if (!signal.aborted)
          logger.error({ cause, sourceId }, "Chat collector lease release failed");
      });
    }

    if (!signal.aborted) await delay(STREAM_RETRY_MS, { signal });
  }
}

export async function runChatCollectors(
  store: ChatCollectorStore,
  broker: ChatEventBroker,
  leases: ChatCollectorLeases,
  collectorControl: ChatCollectorRefreshControl,
  providers: readonly ChatProviderAdapter[],
  signal: AbortSignal,
) {
  const serviceOwner = randomUUID();
  const providerByName = new Map<ChatProvider, ChatProviderAdapter>(
    providers.map((provider) => [provider.provider, provider]),
  );
  const running = new Map<
    string,
    Readonly<{ abort: () => void; generation: symbol; work: Promise<void>; tokenVersion: number }>
  >();
  let reconciliation = Promise.resolve();

  const reconcile = async () => {
    const enabledSources = await store.getAllEnabledSources();
    const desired = new Map(
      enabledSources
        .filter(({ connectedSource }) => {
          return providerByName.get(connectedSource.source.provider)?.collection === "pull";
        })
        .map(({ connectedSource }) => [connectedSource.source.sourceId, connectedSource] as const),
    );

    for (const [sourceId, collector] of running) {
      const desiredSource = desired.get(sourceId);
      if (desiredSource?.credentials.tokenVersion === collector.tokenVersion) continue;
      collector.abort();
      running.delete(sourceId);
    }

    for (const ownedSource of enabledSources) {
      const source = ownedSource.connectedSource.source;
      const provider = providerByName.get(source.provider);
      if (!provider || provider.collection !== "pull" || running.has(source.sourceId)) continue;

      const controller = new AbortController();
      const generation = Symbol(source.sourceId);
      const collectorSignal = AbortSignal.any([signal, controller.signal]);
      const work = collectSource(
        ownedSource,
        provider,
        broker,
        leases,
        serviceOwner,
        collectorSignal,
      ).finally(() => {
        if (running.get(source.sourceId)?.generation === generation) {
          running.delete(source.sourceId);
        }
      });
      running.set(source.sourceId, {
        abort: () => controller.abort(),
        generation,
        work,
        tokenVersion: ownedSource.connectedSource.credentials.tokenVersion,
      });
    }
  };

  const serialized = (work: () => Promise<void>) => {
    const next = reconciliation.then(work);
    reconciliation = next.catch((cause: unknown) =>
      logger.error({ cause }, "Chat collector reconciliation failed"),
    );
    return next;
  };

  const refreshing = (async () => {
    for await (const sourceId of collectorControl.refreshes(signal)) {
      await serialized(async () => {
        const collector = running.get(sourceId);
        if (!collector) return;
        collector.abort();
        running.delete(sourceId);
        await collector.work;
        if (!signal.aborted) await reconcile();
      });
    }
  })();

  try {
    while (!signal.aborted) {
      await serialized(reconcile);
      await delay(RECONCILE_INTERVAL_MS, { signal });
    }
  } finally {
    for (const collector of running.values()) collector.abort();
    await Promise.allSettled([...running.values()].map(({ work }) => work));
    await refreshing;
  }
}
