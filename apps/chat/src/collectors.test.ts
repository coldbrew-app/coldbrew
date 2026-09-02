import {
  ChatSourceIdSchema,
  type ChatSourceId,
  type ChatStreamEvent,
} from "@coldbrew/packages/chat.js";
import { erro } from "@lebedevna/neverthrow-utils";
import { ok } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import type { ChatEventBroker } from "./chat-application.js";
import {
  runChatCollectors,
  type ChatCollectorLeases,
  type ChatCollectorRefreshControl,
  type ChatCollectorStore,
} from "./collectors.js";
import type { ChatProviderAdapter, ConnectedChatSource } from "./provider.js";

const sourceId = ChatSourceIdSchema.parse("00000000-0000-4000-8000-000000000001");
const connectedSource: ConnectedChatSource = {
  source: {
    sourceId,
    connectionId: "10000000-0000-4000-8000-000000000001",
    provider: "youtube",
    providerSourceId: "channel-1",
    displayName: "Channel",
    sourceUrl: "https://www.youtube.com/channel/channel-1",
    position: 0,
    enabled: true,
  },
  capabilities: ["read"],
  credentials: { accessToken: "token", scopes: [], tokenVersion: 1 },
};

const store: ChatCollectorStore = {
  async getAllEnabledSources() {
    return [{ userId: 42, connectedSource }];
  },
};

const leases: ChatCollectorLeases = {
  async acquire() {
    return {
      async maintain(signal) {
        if (signal.aborted) {
          return;
        }
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
      },
      async release() {},
    };
  },
};

function idleRefreshControl(): ChatCollectorRefreshControl {
  return {
    async *refreshes(signal) {
      if (signal.aborted) {
        return;
      }
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
    },
  };
}

describe("chat collectors", () => {
  it("publishes stream errors and continues consuming a retrying provider", async () => {
    const controller = new AbortController();
    const published: ChatStreamEvent[] = [];
    const broker: ChatEventBroker = {
      async publish(_userId, event) {
        published.push(event);
        if (event.type === "state" && event.state === "offline") {
          controller.abort();
        }
      },
      async *stream() {},
    };
    const provider: ChatProviderAdapter = {
      provider: "youtube",
      collection: "pull",
      async *stream() {
        yield erro({ type: "provider unavailable" as const, detail: "temporary" });
        yield ok({ type: "state" as const, sourceId, state: "offline" as const });
      },
      async sendMessage() {
        return ok(undefined);
      },
      async moderate() {
        return ok({});
      },
    };

    await runChatCollectors(
      store,
      broker,
      leases,
      idleRefreshControl(),
      [provider],
      controller.signal,
    );

    expect(published).toEqual([
      { type: "state", sourceId, state: "error", detail: "temporary" },
      { type: "state", sourceId, state: "offline" },
    ]);
  });

  it("restarts the lease owner when a manual refresh is requested", async () => {
    const controller = new AbortController();
    let requestRefresh: ((value: ChatSourceId) => void) | undefined;
    const refreshControl: ChatCollectorRefreshControl = {
      async *refreshes(signal) {
        const refreshedSourceId = await new Promise<ChatSourceId>((resolve) => {
          requestRefresh = resolve;
        });
        if (!signal.aborted) {
          yield refreshedSourceId;
        }
      },
    };
    const broker: ChatEventBroker = {
      async publish(_userId, event) {
        if (event.type !== "state") {
          return;
        }
        if (event.state === "offline") {
          requestRefresh?.(sourceId);
        }
        if (event.state === "live") {
          controller.abort();
        }
      },
      async *stream() {},
    };
    const starts = vi.fn();
    const provider: ChatProviderAdapter = {
      provider: "youtube",
      collection: "pull",
      stream(_source, signal) {
        const start = starts.mock.calls.length;
        starts();
        return (async function* () {
          if (start === 0) {
            yield ok({ type: "state" as const, sourceId, state: "offline" as const });
            if (!signal.aborted) {
              await new Promise<void>((resolve) =>
                signal.addEventListener("abort", () => resolve(), { once: true }),
              );
            }
            return;
          }
          yield ok({ type: "state" as const, sourceId, state: "live" as const });
        })();
      },
      async sendMessage() {
        return ok(undefined);
      },
      async moderate() {
        return ok({});
      },
    };

    await runChatCollectors(store, broker, leases, refreshControl, [provider], controller.signal);

    expect(starts).toHaveBeenCalledTimes(2);
  });
});
