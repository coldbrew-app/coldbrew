import { ok } from "neverthrow";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConnectedChatSource } from "../provider.js";
import { YoutubeChatProvider } from "./youtube.js";

const mocks = vi.hoisted(() => ({
  stream: vi.fn(),
}));

vi.mock("@coldbrew/packages/youtube-live-chat.js", () => ({
  YoutubeLiveChatClient: class {
    readonly stream = mocks.stream;
  },
}));

const connectedSource: ConnectedChatSource = {
  source: {
    sourceId: "00000000-0000-4000-8000-000000000001",
    connectionId: "10000000-0000-4000-8000-000000000001",
    provider: "youtube",
    providerSourceId: "channel-1",
    displayName: "Channel",
    sourceUrl: "https://www.youtube.com/channel/channel-1",
    position: 0,
    enabled: true,
  },
  capabilities: ["read"],
  credentials: {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    scopes: ["https://www.googleapis.com/auth/youtube.force-ssl"],
    tokenVersion: 1,
  },
};

async function nextValue<T>(iterator: AsyncIterator<T>) {
  const result = await iterator.next();
  if (result.done === true) {
    throw new Error("Expected the YouTube provider stream to yield a value.");
  }
  return result.value;
}

describe("YouTube chat provider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    mocks.stream.mockReset();
  });

  it("stays offline without polling until collection is manually restarted", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request) => Response.json({ items: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const iterator = new YoutubeChatProvider()
      .stream(connectedSource, controller.signal)
      [Symbol.asyncIterator]();

    expect((await nextValue(iterator))._unsafeUnwrap()).toMatchObject({
      type: "state",
      state: "connecting",
    });
    expect((await nextValue(iterator))._unsafeUnwrap()).toMatchObject({
      type: "state",
      state: "offline",
    });
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toContain("broadcastType=all");

    controller.abort();
    expect((await iterator.next()).done).toBe(true);
  });

  it("passes the discovered liveChatId and OAuth token directly to gRPC", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ items: [{ snippet: { liveChatId: "live-chat-1" } }] })),
    );
    mocks.stream.mockReturnValue(
      (async function* () {
        yield ok({ type: "state" as const, state: "live" as const });
        yield ok({ type: "state" as const, state: "offline" as const });
      })(),
    );
    const controller = new AbortController();
    const iterator = new YoutubeChatProvider()
      .stream(connectedSource, controller.signal)
      [Symbol.asyncIterator]();

    await iterator.next();
    expect((await nextValue(iterator))._unsafeUnwrap()).toMatchObject({ state: "live" });
    expect(mocks.stream).toHaveBeenCalledWith(
      { liveChatId: "live-chat-1", accessToken: "access-token" },
      expect.any(AbortSignal),
    );
    expect((await nextValue(iterator))._unsafeUnwrap()).toMatchObject({ state: "offline" });

    controller.abort();
    expect((await iterator.next()).done).toBe(true);
  });
});
