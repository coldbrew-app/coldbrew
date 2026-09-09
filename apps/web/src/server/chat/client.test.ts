import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../env.js", () => ({
  env: {
    CHAT_SERVICE_SECRET: "test-chat-service-secret-at-least-32-characters",
    CHAT_SERVICE_URL: "http://chat.test",
  },
}));

import { chatService, ChatServiceError } from "./client.js";

afterEach(() => vi.unstubAllGlobals());

describe("chat service adapter", () => {
  it("authenticates the request and validates and normalizes config", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        connections: [
          {
            connectionId: "019c58be-a09e-7000-8000-000000000001",
            provider: "youtube",
            providerUserId: "channel-1",
            displayName: "Channel",
            status: "connected",
            capabilities: ["read"],
            connectedAt: "2026-09-03T09:00:00Z",
          },
        ],
        sources: [],
        hasOverlayToken: false,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await chatService.config(42);

    expect(result.connections[0]?.connectedAt).toEqual(new Date("2026-09-03T09:00:00Z"));
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toMatch(/\/internal\/config$/);
    expect(new Headers(options?.headers).get("Authorization")).toMatch(/^Bearer .{32,}$/);
    expect(options?.body).toBe(JSON.stringify({ userId: 42 }));
  });

  it("sends Boosty credentials only in the authenticated request body", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json(null));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      chatService.connectBoosty(
        42,
        "boosty-session-token",
        "boosty-refresh-token",
        "device-1",
        1_800_000_000_000,
        true,
      ),
    ).resolves.toBeNull();

    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toMatch(/\/internal\/boosty\/connect$/);
    expect(url).not.toContain("boosty-session-token");
    expect(options?.method).toBe("POST");
    expect(new Headers(options?.headers).get("Authorization")).toMatch(/^Bearer .{32,}$/);
    expect(options?.body).toBe(
      JSON.stringify({
        userId: 42,
        accessToken: "boosty-session-token",
        refreshToken: "boosty-refresh-token",
        deviceId: "device-1",
        expiresAt: 1_800_000_000_000,
        dedicatedSession: true,
      }),
    );
  });

  it("sets a source state without disconnecting its account", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json(null));
    vi.stubGlobal("fetch", fetchMock);
    const sourceId = "019c58be-a09e-7000-8000-000000000001";

    await expect(chatService.setSourceEnabled(42, sourceId, false)).resolves.toBeNull();

    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toMatch(/\/internal\/sources\/enabled$/);
    expect(options?.body).toBe(JSON.stringify({ enabled: false, sourceId, userId: 42 }));
  });

  it("rejects an invalid response before it reaches tRPC", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ connections: "invalid" })),
    );

    await expect(chatService.config(42)).rejects.toMatchObject({
      name: ChatServiceError.name,
      type: "chat service error",
      detail: "validation error",
    });
  });

  it("loads and validates a dead letter page", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        items: [
          {
            sequence: "41",
            failedAt: "2026-09-08T12:00:00Z",
            sourceSubject: "chat.user.42",
            error: "unexpected end of JSON input",
            payload: "eyJ0eXBlIjo=",
            payloadTruncated: false,
          },
        ],
        total: 1,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await chatService.deadLetters("42");

    expect(result.items[0]?.failedAt).toEqual(new Date("2026-09-08T12:00:00Z"));
    const requestInput = fetchMock.mock.calls[0]?.[0];
    if (requestInput === undefined) {
      throw new Error("Expected a dead letter request.");
    }
    const requestedUrl = new URL(
      typeof requestInput === "string"
        ? requestInput
        : requestInput instanceof URL
          ? requestInput.href
          : requestInput.url,
    );
    expect(requestedUrl.pathname).toBe("/internal/dead-letters");
    expect(Object.fromEntries(requestedUrl.searchParams)).toEqual({
      beforeSequence: "42",
      limit: "25",
    });
  });

  it("validates every streamed NDJSON event", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            [
              JSON.stringify({
                type: "message",
                message: {
                  id: "message-1",
                  sourceId: "019c58be-a09e-7000-8000-000000000001",
                  connectionId: "019c58be-a09e-7000-8000-000000000002",
                  provider: "youtube",
                  author: { id: "author-1", displayName: "Viewer" },
                  text: "hello",
                  occurredAt: "2026-09-03T09:00:00Z",
                },
              }),
              JSON.stringify({ type: "unknown" }),
            ].join("\n") + "\n",
            { headers: { "Content-Type": "application/x-ndjson" } },
          ),
      ),
    );

    const controller = new AbortController();
    const iterator = chatService.stream(42, controller.signal)[Symbol.asyncIterator]();
    const first = await iterator.next();
    if (first.done === true) {
      throw new Error("Expected the chat stream to yield an event.");
    }
    expect(first.value.type).toBe("message");
    if (first.value.type === "message") {
      expect(first.value.message.occurredAt).toEqual(new Date("2026-09-03T09:00:00Z"));
    }
    await expect(iterator.next()).rejects.toMatchObject({
      name: ChatServiceError.name,
      detail: "validation error",
    });
  });

  it("treats cancellation as normal stream completion", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>((_input, init) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          });
        });
      }),
    );
    const controller = new AbortController();
    const iterator = chatService.stream(42, controller.signal)[Symbol.asyncIterator]();
    const pending = iterator.next();

    controller.abort();

    await expect(pending).resolves.toEqual({ done: true, value: undefined });
  });
});
