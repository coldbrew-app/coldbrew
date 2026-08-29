import { describe, expect, it, vi } from "vitest";

import { YoutubeLiveChatClient } from "./youtube-live-chat.js";

describe("YouTube live chat client", () => {
  it("normalizes a video without an active chat as offline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ items: [{}] }), { status: 200 })),
    );
    const iterator = new YoutubeLiveChatClient({ apiKey: "api-key" })
      .stream("video-id")
      [Symbol.asyncIterator]();

    expect((await iterator.next()).value?._unsafeUnwrap()).toEqual({
      type: "state",
      state: "connecting",
    });
    expect((await iterator.next()).value?._unsafeUnwrap()).toEqual({
      type: "state",
      state: "offline",
    });

    await iterator.return?.();
    vi.unstubAllGlobals();
  });

  it("returns lookup failures without rejecting the iterator", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unavailable", { status: 503 })),
    );
    const iterator = new YoutubeLiveChatClient({ apiKey: "api-key" })
      .stream("video-id")
      [Symbol.asyncIterator]();

    await iterator.next();
    const failed = await iterator.next();

    expect(failed.value?.isErr()).toBe(true);
    if (failed.value?.isErr()) {
      expect(failed.value.error).toMatchObject({
        type: "youtube live chat error",
        operation: "lookup",
        isAbort: false,
      });
    }

    await iterator.return?.();
    vi.unstubAllGlobals();
  });
});
