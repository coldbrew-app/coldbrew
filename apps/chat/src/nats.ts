import { randomUUID } from "node:crypto";

import {
  ChatSourceIdSchema,
  ChatStreamEventSchema,
  type ChatSourceId,
  type ChatStreamEvent,
} from "@coldbrew/packages/chat.js";
import { delay } from "@lebedevna/delay";
import {
  connect,
  DiscardPolicy,
  nanos,
  RetentionPolicy,
  StorageType,
  StringCodec,
  KvWatchInclude,
  type JetStreamClient,
  type KV,
  type NatsConnection,
} from "nats";
import { SuperJSON } from "superjson";

import type { ChatCollectorControl, ChatEventBroker } from "./chat-application.js";

const CHAT_STREAM = "CHAT_EVENTS";
const CHAT_SUBJECT = "chat.user.*";
const CHAT_EVENT_MAX_AGE_MS = 15 * 60 * 1_000;
const CHAT_EVENT_MAX_PER_USER = 2_500;
const CHAT_EVENT_DUPLICATE_WINDOW_MS = 2 * 60 * 1_000;
const COLLECTOR_LEASE_BUCKET = "chat_collectors";
const CHAT_STATE_BUCKET = "chat_source_states";
const COLLECTOR_REFRESH_BUCKET = "chat_collector_refreshes";
const COLLECTOR_LEASE_TTL_MS = 30_000;
const COLLECTOR_LEASE_HEARTBEAT_MS = 10_000;
const codec = StringCodec();

function userSubject(userId: number) {
  return `chat.user.${userId}`;
}

function sourceStateKey(userId: number, sourceId: string) {
  return `${userId}.${sourceId}`;
}

async function ensureChatStream(connection: NatsConnection) {
  const manager = await connection.jetstreamManager();
  const streams = await manager.streams.list(CHAT_SUBJECT).next();
  if (streams.some((stream) => stream.config.name === CHAT_STREAM)) {
    return;
  }
  await manager.streams.add({
    name: CHAT_STREAM,
    subjects: [CHAT_SUBJECT],
    storage: StorageType.Memory,
    retention: RetentionPolicy.Limits,
    discard: DiscardPolicy.Old,
    max_age: nanos(CHAT_EVENT_MAX_AGE_MS),
    max_msgs_per_subject: CHAT_EVENT_MAX_PER_USER,
    duplicate_window: nanos(CHAT_EVENT_DUPLICATE_WINDOW_MS),
  });
}

export class NatsChatEventBroker implements ChatEventBroker {
  constructor(
    private readonly connection: NatsConnection,
    private readonly jetstream: JetStreamClient,
    private readonly states: KV,
  ) {}

  async publish(userId: number, event: ChatStreamEvent, idempotencyKey: string) {
    await this.jetstream.publish(userSubject(userId), codec.encode(SuperJSON.stringify(event)), {
      msgID: idempotencyKey,
    });
    const stateEvent =
      event.type === "state"
        ? event
        : event.type === "message"
          ? ({ type: "state", sourceId: event.message.sourceId, state: "live" } as const)
          : null;
    if (stateEvent) {
      await this.states.put(
        sourceStateKey(userId, stateEvent.sourceId),
        codec.encode(SuperJSON.stringify(stateEvent)),
      );
    }
  }

  async *stream(userId: number, signal: AbortSignal): AsyncIterable<ChatStreamEvent> {
    const subscription = this.connection.subscribe(userSubject(userId));
    const stop = () => subscription.unsubscribe();
    signal.addEventListener("abort", stop, { once: true });
    try {
      const stateKeys = await this.states.keys(`${userId}.*`);
      for await (const key of stateKeys) {
        const state = await this.states.get(key);
        if (state) {
          yield ChatStreamEventSchema.parse(SuperJSON.parse(codec.decode(state.value)));
        }
      }
      for await (const message of subscription) {
        yield ChatStreamEventSchema.parse(SuperJSON.parse(codec.decode(message.data)));
      }
    } finally {
      signal.removeEventListener("abort", stop);
      subscription.unsubscribe();
    }
  }
}

export type CollectorLease = Readonly<{
  maintain(signal: AbortSignal): Promise<void>;
  release(): Promise<void>;
}>;

export class NatsCollectorLeases {
  constructor(private readonly bucket: KV) {}

  async acquire(key: string, owner: string): Promise<CollectorLease | null> {
    let revision: number;
    try {
      revision = await this.bucket.create(key, codec.encode(owner));
    } catch (cause) {
      const current = await this.bucket.get(key);
      if (current) {
        return null;
      }
      throw cause;
    }

    const bucket = this.bucket;
    return {
      async maintain(signal) {
        while (!signal.aborted) {
          await delay(COLLECTOR_LEASE_HEARTBEAT_MS, { signal });
          if (signal.aborted) {
            return;
          }
          revision = await bucket.update(key, codec.encode(owner), revision);
        }
      },
      async release() {
        await bucket.delete(key, { previousSeq: revision });
      },
    };
  }
}

export class NatsChatCollectorControl implements ChatCollectorControl {
  constructor(private readonly bucket: KV) {}

  async requestRefresh(sourceId: ChatSourceId) {
    await this.bucket.put(sourceId, codec.encode(randomUUID()));
  }

  async *refreshes(signal: AbortSignal): AsyncIterable<ChatSourceId> {
    const watcher = await this.bucket.watch({
      ignoreDeletes: true,
      include: KvWatchInclude.UpdatesOnly,
    });
    const stop = () => watcher.stop();
    signal.addEventListener("abort", stop, { once: true });
    try {
      for await (const entry of watcher) {
        if (entry.operation === "PUT") {
          yield ChatSourceIdSchema.parse(entry.key);
        }
      }
    } finally {
      signal.removeEventListener("abort", stop);
      watcher.stop();
    }
  }
}

export async function connectChatNats(servers: string) {
  const connection = await connect({ servers: servers.split(",").map((server) => server.trim()) });
  await ensureChatStream(connection);
  const jetstream = connection.jetstream();
  const bucket = await jetstream.views.kv(COLLECTOR_LEASE_BUCKET, {
    ttl: COLLECTOR_LEASE_TTL_MS,
    history: 1,
    storage: StorageType.Memory,
  });
  const states = await jetstream.views.kv(CHAT_STATE_BUCKET, {
    ttl: CHAT_EVENT_MAX_AGE_MS,
    history: 1,
    storage: StorageType.Memory,
  });
  const refreshes = await jetstream.views.kv(COLLECTOR_REFRESH_BUCKET, {
    ttl: CHAT_EVENT_MAX_AGE_MS,
    history: 1,
    storage: StorageType.Memory,
  });
  return {
    broker: new NatsChatEventBroker(connection, jetstream, states),
    close: async () => await connection.drain(),
    collectorControl: new NatsChatCollectorControl(refreshes),
    leases: new NatsCollectorLeases(bucket),
  };
}
