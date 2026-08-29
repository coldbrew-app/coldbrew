import { afterEach, describe, expect, it, vi } from "vitest";

import { AccessTokenSchema, RefreshTokenSchema } from "./schemas.js";

const state = vi.hoisted(() => ({
  sockets: [] as TestWebSocket[],
}));

class TestWebSocket extends EventTarget {
  readonly sent: string[] = [];
  readonly close = vi.fn();
  readonly send = vi.fn((message: string) => this.sent.push(message));

  constructor(readonly url: string) {
    super();
    state.sockets.push(this);
  }
}

const { getAuthorizationUrl, getDonations, issueConnection, refreshTokens, subscribeToDonations } =
  await import("./donationalerts.js");

const accessToken = AccessTokenSchema.parse("access-token");
const refreshToken = RefreshTokenSchema.parse("refresh-token");
const config = { clientId: "client-id", clientSecret: "secret" };
const socketProfile = {
  data: {
    id: 42,
    socket_connection_token: "socket-connection-token",
  },
};

function stubRealtimeFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://www.donationalerts.com/api/v1/user/oauth") {
      return new Response(JSON.stringify(socketProfile));
    }
    if (url === "https://www.donationalerts.com/api/v1/centrifuge/subscribe") {
      return new Response(
        JSON.stringify({
          channels: [{ channel: "$alerts:donation_42", token: "channel-token" }],
        }),
      );
    }
    throw new Error(`Unexpected request: ${url} ${String(init?.method)}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("WebSocket", TestWebSocket);
  return fetchMock;
}

async function waitForSocket(index = 0) {
  await vi.waitFor(() => expect(state.sockets[index]).toBeDefined());
  return state.sockets[index]!;
}

afterEach(() => {
  state.sockets.length = 0;
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("DonationAlerts OAuth", () => {
  it("builds an authorization URL from the explicit client ID", () => {
    const url = new URL(getAuthorizationUrl(config.clientId, "https://example.com/callback"));

    expect(url.origin + url.pathname).toBe("https://www.donationalerts.com/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "client-id",
      redirect_uri: "https://example.com/callback",
      response_type: "code",
      scope: "oauth-user-show oauth-donation-subscribe oauth-donation-index",
    });
  });

  it("issues a connection from explicit configuration", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: accessToken, refresh_token: refreshToken })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 42 } })));
    vi.stubGlobal("fetch", fetchMock);

    const $connection = await issueConnection(
      config,
      "authorization-code",
      "https://example.com/callback",
    );

    expect($connection._unsafeUnwrap()).toEqual({
      accessToken,
      refreshToken,
      sourceUserId: "42",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://www.donationalerts.com/oauth/token");
  });

  it("refreshes tokens from explicit configuration", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ access_token: accessToken, refresh_token: refreshToken })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const $tokens = await refreshTokens(config, refreshToken);

    expect($tokens._unsafeUnwrap()).toEqual({ accessToken, refreshToken });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("getDonations", () => {
  it("maps validated donation pages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: [
                {
                  id: 1,
                  username: "Streamer",
                  message: "Thank you",
                  amount: "10.00",
                  currency: "USD",
                  created_at: "2026-08-22 12:00:00",
                },
              ],
              meta: { last_page: 1 },
            }),
          ),
      ),
    );

    const $donations = await getDonations(accessToken);

    expect($donations._unsafeUnwrap()).toMatchObject([
      {
        source: "donationalerts",
        sourceDonationId: "1",
        sourceCreatedAt: "2026-08-22 12:00:00",
        occurredAt: new Date("2026-08-22T12:00:00.000Z"),
      },
    ]);
  });

  it("returns an error for an invalid donation date", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: [
                {
                  id: 1,
                  username: null,
                  message: null,
                  amount: "10.00",
                  currency: "USD",
                  created_at: "not-a-date",
                },
              ],
              meta: { last_page: 1 },
            }),
          ),
      ),
    );

    const $donations = await getDonations(accessToken);

    expect($donations._unsafeUnwrapErr()).toMatchObject({
      type: "donationalerts: request error",
    });
  });

  it("classifies an HTTP 401 without inspecting an error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Unauthorized", { status: 401 })),
    );

    const $donations = await getDonations(accessToken);

    expect($donations._unsafeUnwrapErr()).toMatchObject({
      type: "donationalerts: unauthorized",
    });
  });
});

describe("subscribeToDonations", () => {
  it("does not open a connection for an already aborted signal", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", TestWebSocket);
    const controller = new AbortController();
    controller.abort();

    const iterator = subscribeToDonations(accessToken, controller.signal)[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.sockets).toHaveLength(0);
  });

  it("ends the iterator and closes the connection when aborted", async () => {
    stubRealtimeFetch();
    const controller = new AbortController();
    const iterator = subscribeToDonations(accessToken, controller.signal)[Symbol.asyncIterator]();
    const nextEvent = iterator.next();
    const socket = await waitForSocket();

    controller.abort();

    await expect(nextEvent).resolves.toEqual({ done: true, value: undefined });
    expect(socket.close).toHaveBeenCalledOnce();
  });

  it("authorizes, subscribes, and maps donation messages", async () => {
    const fetchMock = stubRealtimeFetch();
    const iterator = subscribeToDonations(accessToken)[Symbol.asyncIterator]();
    const nextEvent = iterator.next();
    const socket = await waitForSocket();

    expect(socket.url).toBe("wss://centrifugo.donationalerts.com/connection/websocket");
    socket.dispatchEvent(new Event("open"));
    expect(socket.sent.map((message) => JSON.parse(message))).toEqual([
      { params: { token: "socket-connection-token" }, id: 1 },
    ]);

    socket.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({
          id: 1,
          result: { client: "d558c046-c679-43e3-a62d-65989ab55f7c", version: "2.2.1" },
        }),
      }),
    );
    await vi.waitFor(() => expect(socket.sent).toHaveLength(2));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://www.donationalerts.com/api/v1/centrifuge/subscribe",
    );
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer access-token",
        "Content-Type": "application/json",
      },
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      channels: ["$alerts:donation_42"],
      client: "d558c046-c679-43e3-a62d-65989ab55f7c",
    });
    expect(JSON.parse(socket.sent[1]!)).toEqual({
      id: 2,
      method: 1,
      params: { channel: "$alerts:donation_42", token: "channel-token" },
    });

    socket.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({
          result: {
            channel: "$alerts:donation_42",
            data: {
              data: {
                id: 1,
                username: "Streamer",
                message: "Thank you",
                amount: "10.00",
                currency: "USD",
                created_at: "2026-08-22 12:00:00",
              },
            },
          },
        }),
      }),
    );

    await expect(nextEvent).resolves.toMatchObject({
      done: false,
      value: {
        name: "donation",
        data: {
          sourceDonationId: "1",
          occurredAt: new Date("2026-08-22T12:00:00.000Z"),
        },
      },
    });
    await iterator.return?.();
    expect(socket.close).toHaveBeenCalledOnce();
  });

  it("yields a terminal error for a socket failure", async () => {
    stubRealtimeFetch();
    const iterator = subscribeToDonations(accessToken)[Symbol.asyncIterator]();
    const nextEvent = iterator.next();
    const socket = await waitForSocket();

    socket.dispatchEvent(new Event("error"));

    await expect(nextEvent).resolves.toMatchObject({
      done: false,
      value: { name: "error", data: { type: "donationalerts: request error" } },
    });
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    expect(socket.close).toHaveBeenCalledOnce();
  });

  it("yields a terminal error for an invalid WebSocket message", async () => {
    stubRealtimeFetch();
    const iterator = subscribeToDonations(accessToken)[Symbol.asyncIterator]();
    const nextEvent = iterator.next();
    const socket = await waitForSocket();

    socket.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({ type: "donation", result: {} }),
      }),
    );

    await expect(nextEvent).resolves.toMatchObject({
      done: false,
      value: {
        name: "error",
        data: {
          type: "donationalerts: request error",
          message: "Invalid DonationAlerts WebSocket message",
        },
      },
    });
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    expect(socket.close).toHaveBeenCalledOnce();
  });

  it("classifies a profile HTTP 401 as unauthorized", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Unauthorized", { status: 401 })),
    );
    vi.stubGlobal("WebSocket", TestWebSocket);
    const iterator = subscribeToDonations(accessToken)[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { name: "error", data: { type: "donationalerts: unauthorized" } },
    });
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    expect(state.sockets).toHaveLength(0);
  });

  it("rejects an invalid profile response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ data: { id: 42 } }))),
    );
    vi.stubGlobal("WebSocket", TestWebSocket);
    const iterator = subscribeToDonations(accessToken)[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { name: "error", data: { type: "donationalerts: request error" } },
    });
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    expect(state.sockets).toHaveLength(0);
  });

  it("classifies a channel-token HTTP 401 as unauthorized", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify(socketProfile)))
        .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 })),
    );
    vi.stubGlobal("WebSocket", TestWebSocket);
    const iterator = subscribeToDonations(accessToken)[Symbol.asyncIterator]();
    const nextEvent = iterator.next();
    const socket = await waitForSocket();

    socket.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({
          id: 1,
          result: { client: "d558c046-c679-43e3-a62d-65989ab55f7c", version: "2.2.1" },
        }),
      }),
    );

    await expect(nextEvent).resolves.toMatchObject({
      done: false,
      value: { name: "error", data: { type: "donationalerts: unauthorized" } },
    });
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    expect(socket.close).toHaveBeenCalledOnce();
  });

  it("reconnects after a clean close", async () => {
    stubRealtimeFetch();
    const controller = new AbortController();
    const iterator = subscribeToDonations(accessToken, controller.signal)[Symbol.asyncIterator]();
    const nextEvent = iterator.next();
    const firstSocket = await waitForSocket();

    vi.useFakeTimers();
    firstSocket.dispatchEvent(new Event("close"));
    await vi.advanceTimersByTimeAsync(5_000);

    expect(state.sockets).toHaveLength(2);
    const secondSocket = state.sockets[1]!;
    secondSocket.dispatchEvent(new Event("open"));
    expect(secondSocket.sent.map((message) => JSON.parse(message))).toEqual([
      { params: { token: "socket-connection-token" }, id: 1 },
    ]);

    controller.abort();
    await expect(nextEvent).resolves.toEqual({ done: true, value: undefined });
    expect(firstSocket.close).toHaveBeenCalledOnce();
    expect(secondSocket.close).toHaveBeenCalledOnce();
  });

  it("cancels a pending reconnect", async () => {
    stubRealtimeFetch();
    const controller = new AbortController();
    const iterator = subscribeToDonations(accessToken, controller.signal)[Symbol.asyncIterator]();
    const nextEvent = iterator.next();
    const socket = await waitForSocket();

    vi.useFakeTimers();
    socket.dispatchEvent(new Event("close"));
    controller.abort();

    await expect(nextEvent).resolves.toEqual({ done: true, value: undefined });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(state.sockets).toHaveLength(1);
  });
});
