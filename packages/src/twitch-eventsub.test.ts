import { afterEach, describe, expect, it, vi } from "vitest";

import { twitchSocketEvents } from "./twitch-eventsub.js";

const state = vi.hoisted(() => ({
  sockets: [] as TestWebSocket[],
}));

class TestWebSocket extends EventTarget {
  close = vi.fn();

  constructor() {
    super();
    state.sockets.push(this);
  }
}

afterEach(() => {
  state.sockets.length = 0;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("twitchSocketEvents", () => {
  it("ignores an unknown EventSub message type", async () => {
    vi.stubGlobal("WebSocket", TestWebSocket);
    const iterator = twitchSocketEvents(new AbortController().signal)[Symbol.asyncIterator]();
    const nextEvent = iterator.next();
    const socket = state.sockets[0]!;

    socket.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({ metadata: { message_type: "unrecognized" } }),
      }),
    );
    socket.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({
          metadata: { message_type: "session_welcome" },
          payload: { session: { id: "session-id" } },
        }),
      }),
    );

    const event = await nextEvent;
    expect(event.done).toBe(false);
    expect(event.value._unsafeUnwrap()).toEqual({ type: "welcome", sessionId: "session-id" });
    await iterator.return?.();
  });

  it("yields a typed error for a malformed known EventSub message", async () => {
    vi.stubGlobal("WebSocket", TestWebSocket);
    const iterator = twitchSocketEvents(new AbortController().signal)[Symbol.asyncIterator]();
    const nextEvent = iterator.next();
    const socket = state.sockets[0]!;

    socket.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({
          metadata: { message_type: "notification" },
        }),
      }),
    );

    const event = await nextEvent;
    expect(event.done).toBe(false);
    expect(event.value._unsafeUnwrapErr()).toMatchObject({
      type: "twitch operation error",
      detail: "Could not decode the Twitch socket message",
    });
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    expect(socket.close).toHaveBeenCalledOnce();
  });
});
