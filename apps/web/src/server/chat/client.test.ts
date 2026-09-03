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
