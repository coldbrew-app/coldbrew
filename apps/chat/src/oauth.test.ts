import { describe, expect, it, vi } from "vitest";

import { ChatOauth, chatOauthConfigs } from "./oauth.js";
import type { ChatStore } from "./store.js";

describe("chat OAuth", () => {
  it("uses the web proxy URL for provider callbacks", async () => {
    const store = {
      createOauthAttempt: vi.fn(async () => undefined),
    } as unknown as ChatStore;
    const oauth = new ChatOauth(
      store,
      "http://localhost:5173",
      chatOauthConfigs({ youtube: { clientId: "client-id", clientSecret: "client-secret" } }),
    );

    const $authorizationUrl = await oauth.start(42, "youtube", "http://localhost:5173/chat");

    expect(new URL($authorizationUrl._unsafeUnwrap()).searchParams.get("redirect_uri")).toBe(
      "http://localhost:5173/api/chat/oauth/youtube/callback",
    );
  });

  it("subscribes to Kick chat events through webhooks", async () => {
    const store = {
      createOauthAttempt: vi.fn(async () => undefined),
      consumeOauthAttempt: vi.fn(async () => ({
        userId: 42,
        provider: "kick",
        verifier: "verifier",
        returnUrl: "http://localhost:5173/chat",
      })),
      hasSourceCapacity: vi.fn(async () => true),
      saveProviderAccount: vi.fn(async () => undefined),
    } as unknown as ChatStore;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"access_token":"token"}'))
      .mockResolvedValueOnce(
        new Response('{"data":[{"broadcaster_user_id":123,"slug":"streamer"}]}'),
      )
      .mockResolvedValueOnce(new Response('{"data":[]}'));
    vi.stubGlobal("fetch", fetchMock);
    const oauth = new ChatOauth(
      store,
      "http://localhost:5173",
      chatOauthConfigs({ kick: { clientId: "client-id", clientSecret: "client-secret" } }),
    );

    await oauth.finish(
      "kick",
      "http://localhost:5173/api/chat/oauth/kick/callback?state=state&code=code",
      AbortSignal.timeout(1_000),
    );

    expect(JSON.parse(fetchMock.mock.calls[2]?.[1]?.body as string)).toEqual({
      broadcaster_user_id: 123,
      method: "webhook",
      events: [{ name: "chat.message.sent", version: 1 }],
    });
  });
});
