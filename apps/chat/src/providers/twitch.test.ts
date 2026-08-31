import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConnectedChatSource } from "../provider.js";
import { TwitchChatProvider } from "./twitch.js";

const connectedSource: ConnectedChatSource = {
  source: {
    sourceId: "00000000-0000-4000-8000-000000000001",
    connectionId: "00000000-0000-4000-8000-000000000002",
    provider: "twitch",
    providerSourceId: "42",
    displayName: "coldbrew",
    sourceUrl: "https://www.twitch.tv/coldbrew",
    position: 0,
    enabled: true,
  },
  capabilities: ["read", "send_message"],
  credentials: {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    scopes: ["user:read:chat", "user:write:chat"],
    tokenVersion: 1,
  },
};

afterEach(() => vi.unstubAllGlobals());

describe("TwitchChatProvider.sendMessage", () => {
  it("treats a successful HTTP response with a Twitch drop reason as a failed command", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: [
            {
              message_id: "message-1",
              is_sent: false,
              drop_reason: { code: "automod_held", message: "Message held by AutoMod" },
            },
          ],
        }),
      ),
    );

    const $result = await new TwitchChatProvider("client", "secret").sendMessage(
      connectedSource,
      "hello",
      new AbortController().signal,
    );

    expect($result.isErr()).toBe(true);
    if ($result.isErr()) {
      expect($result.error).toMatchObject({
        type: "provider rejected command",
        detail: "Message held by AutoMod",
      });
    }
  });

  it("accepts a message only when Twitch confirms delivery", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: [{ message_id: "message-1", is_sent: true, drop_reason: null }],
        }),
      ),
    );

    const $result = await new TwitchChatProvider("client", "secret").sendMessage(
      connectedSource,
      "hello",
      new AbortController().signal,
    );

    expect($result.isOk()).toBe(true);
  });
});
