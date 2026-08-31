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
});
