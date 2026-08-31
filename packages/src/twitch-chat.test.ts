import { ok } from "neverthrow";
import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  validateCredentials: vi.fn(async (credentials) => ok(credentials)),
  resolveBroadcasterId: vi.fn(async (_credentials, channel: string) => ok(`id:${channel}`)),
  createSubscription: vi.fn(async () => ok(undefined)),
}));

vi.mock("./twitch-chat-api.js", () => ({ twitchChatApi: api }));

const { TwitchChatClient } = await import("./twitch-chat.js");

const credentials = {
  accessToken: "access-token",
  refreshToken: "refresh-token",
  botUserId: "bot-id",
  clientId: "client-id",
  clientSecret: "client-secret",
};

class FakeWebSocket extends EventTarget {
  static instances: FakeWebSocket[] = [];
  readonly url: string;

  constructor(url: string) {
    super();
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  close() {}

  message(value: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) }));
  }
}

afterEach(() => {
  FakeWebSocket.instances.length = 0;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("Twitch live chat client", () => {
  it("shares a socket and routes normalized messages by channel", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const client = new TwitchChatClient(credentials);
    const first = client.stream("channel-a")[Symbol.asyncIterator]();
    const second = client.stream("channel-b")[Symbol.asyncIterator]();

    await first.next();
    await second.next();
    const socket = FakeWebSocket.instances[0]!;
    socket.message({
      metadata: { message_type: "session_welcome" },
      payload: { session: { id: "session-1" } },
    });
    await vi.waitFor(() => expect(api.createSubscription).toHaveBeenCalledTimes(2));
    socket.message({
      metadata: {
        message_type: "notification",
        message_timestamp: "2026-08-27T12:00:00Z",
      },
      payload: {
        event: {
          broadcaster_user_login: "channel-a",
          chatter_user_id: "viewer-1",
          chatter_user_name: "Viewer",
          message_id: "message-1",
          message: { text: "Hello" },
        },
      },
    });

    await first.next();
    const message = await first.next();
    expect(message.value?._unsafeUnwrap()).toMatchObject({
      type: "message",
      channel: "channel-a",
      id: "message-1",
    });
    expect(FakeWebSocket.instances).toHaveLength(1);

    await first.return?.();
    await second.return?.();
  });

  it("uses Twitch reconnect URLs without opening parallel sockets", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const iterator = new TwitchChatClient(credentials).stream("channel-a")[Symbol.asyncIterator]();
    await iterator.next();
    const firstSocket = FakeWebSocket.instances[0]!;
    firstSocket.message({
      metadata: { message_type: "session_reconnect" },
      payload: { session: { reconnect_url: "wss://eventsub.wss.twitch.tv/reconnect" } },
    });

    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2));
    expect(FakeWebSocket.instances[1]?.url).toBe("wss://eventsub.wss.twitch.tv/reconnect");
    await iterator.return?.();
  });

  it("reports a revoked EventSub subscription to its channel", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const iterator = new TwitchChatClient(credentials).stream("channel-a")[Symbol.asyncIterator]();
    await iterator.next();
    const socket = FakeWebSocket.instances[0]!;
    socket.message({
      metadata: { message_type: "session_welcome" },
      payload: { session: { id: "session-1" } },
    });
    await vi.waitFor(() => expect(api.createSubscription).toHaveBeenCalledOnce());
    await iterator.next();

    socket.message({
      metadata: { message_type: "revocation" },
      payload: {
        subscription: {
          status: "authorization_revoked",
          condition: { broadcaster_user_id: "id:channel-a" },
        },
      },
    });

    const revoked = await iterator.next();
    expect(revoked.value?._unsafeUnwrapErr()).toMatchObject({
      type: "twitch chat error",
      operation: "subscription",
      channel: "channel-a",
      cause: { type: "revocation", reason: "authorization_revoked" },
    });
    await iterator.return?.();
  });
});
