import { createHash, randomBytes } from "node:crypto";

import type { ChatProvider } from "@coldbrew/packages/chat.js";
import { erro, parseJson, safeFetch, validate } from "@lebedevna/neverthrow-utils";
import { rurl } from "@lebedevna/readonly-url";
import { ok, safeTry, type Result } from "neverthrow";
import { z } from "zod";

import type { ChatStore } from "./store.js";

const OAUTH_ATTEMPT_LIFETIME_MS = 10 * 60 * 1_000;

export type ChatOauthProvider = Extract<ChatProvider, "youtube" | "twitch" | "kick">;

type ProviderConfig = Readonly<{
  provider: ChatOauthProvider;
  clientId: string;
  clientSecret: string;
  authorizationUrl: string;
  tokenUrl: string;
  scopes: readonly string[];
}>;

export type ChatOauthError = Readonly<{
  type:
    | "oauth provider unavailable"
    | "invalid oauth callback"
    | "expired oauth attempt"
    | "oauth token exchange failed"
    | "oauth profile failed"
    | "chat source limit reached";
  detail: string;
  returnUrl?: string;
  cause?: unknown;
}>;

type ProviderIdentity = Readonly<{
  providerUserId: string;
  displayName: string;
  sourceUrl: string;
}>;

type ChatOauthStore = Pick<
  ChatStore,
  "consumeOauthAttempt" | "createOauthAttempt" | "hasSourceCapacity" | "saveProviderAccount"
>;

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().positive().optional(),
  scope: z.union([z.string(), z.array(z.string())]).optional(),
});

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function codeChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

function callbackUrl(publicUrl: string, provider: ChatOauthProvider) {
  const url = rurl(publicUrl);
  const basePath = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
  return url.withPathname(`${basePath}/oauth/${provider}/callback`).href;
}

function normalizedScopes(
  value: string | readonly string[] | undefined,
  fallback: readonly string[],
) {
  if (typeof value === "string") {
    return value.split(/[ ,]+/).filter(Boolean);
  }
  return value ? [...value] : [...fallback];
}

async function identity(
  provider: ChatOauthProvider,
  clientId: string,
  accessToken: string,
  signal: AbortSignal,
): Promise<Result<ProviderIdentity, ChatOauthError>> {
  if (provider === "youtube") {
    const schema = z.object({
      items: z.array(
        z.object({ id: z.string().min(1), snippet: z.object({ title: z.string().min(1) }) }),
      ),
    });
    const url = rurl("https://www.googleapis.com/youtube/v3/channels").withSearchParams({
      part: "id,snippet",
      mine: true,
    });
    const $profile = await safeFetch(url.href, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal,
    })
      .andThen(parseJson)
      .andThen((value) => validate(value, schema));
    if ($profile.isErr()) {
      return erro({
        type: "oauth profile failed",
        detail: "Не удалось получить канал YouTube",
        cause: $profile.error,
      });
    }
    const channel = $profile.value.items[0];
    return channel
      ? ok({
          providerUserId: channel.id,
          displayName: channel.snippet.title,
          sourceUrl: rurl(`/channel/${channel.id}`, "https://www.youtube.com").href,
        })
      : erro({ type: "oauth profile failed", detail: "У аккаунта нет канала YouTube" });
  }

  if (provider === "twitch") {
    const schema = z.object({
      data: z.array(
        z.object({
          id: z.string().min(1),
          login: z.string().min(1),
          display_name: z.string().min(1),
        }),
      ),
    });
    const $profile = await safeFetch("https://api.twitch.tv/helix/users", {
      headers: { Authorization: `Bearer ${accessToken}`, "Client-Id": clientId },
      signal,
    })
      .andThen(parseJson)
      .andThen((value) => validate(value, schema));
    if ($profile.isErr()) {
      return erro({
        type: "oauth profile failed",
        detail: "Не удалось получить канал Twitch",
        cause: $profile.error,
      });
    }
    const channel = $profile.value.data[0];
    return channel
      ? ok({
          providerUserId: channel.id,
          displayName: channel.login.toLowerCase(),
          sourceUrl: rurl(`/${channel.login.toLowerCase()}`, "https://www.twitch.tv").href,
        })
      : erro({ type: "oauth profile failed", detail: "У аккаунта нет канала Twitch" });
  }

  const schema = z.object({
    data: z.array(
      z.object({
        broadcaster_user_id: z.union([z.string(), z.number()]).transform(String),
        slug: z.string().min(1),
      }),
    ),
  });
  const $profile = await safeFetch("https://api.kick.com/public/v1/channels", {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal,
  })
    .andThen(parseJson)
    .andThen((value) => validate(value, schema));
  if ($profile.isErr()) {
    return erro({
      type: "oauth profile failed",
      detail: "Не удалось получить канал Kick",
      cause: $profile.error,
    });
  }
  const channel = $profile.value.data[0];
  return channel
    ? ok({
        providerUserId: channel.broadcaster_user_id,
        displayName: channel.slug,
        sourceUrl: rurl(`/${channel.slug}`, "https://kick.com").href,
      })
    : erro({ type: "oauth profile failed", detail: "У аккаунта нет канала Kick" });
}

export class ChatOauth {
  private readonly configs: ReadonlyMap<ChatOauthProvider, ProviderConfig>;

  constructor(
    private readonly store: ChatOauthStore,
    private readonly publicUrl: string,
    configs: readonly ProviderConfig[],
  ) {
    this.configs = new Map(configs.map((config) => [config.provider, config]));
  }

  available(provider: ChatOauthProvider) {
    return this.configs.has(provider);
  }

  async start(userId: number, provider: ChatOauthProvider, returnUrl: string) {
    const config = this.configs.get(provider);
    if (!config) {
      return erro<ChatOauthError>({
        type: "oauth provider unavailable",
        detail: `OAuth для ${provider} не настроен`,
      });
    }
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    await this.store.createOauthAttempt(
      sha256(state),
      userId,
      provider,
      verifier,
      returnUrl,
      new Date(Date.now() + OAUTH_ATTEMPT_LIFETIME_MS),
    );
    let url = rurl(config.authorizationUrl).withSearchParams({
      response_type: "code",
      client_id: config.clientId,
      redirect_uri: callbackUrl(this.publicUrl, provider),
      scope: config.scopes.join(" "),
      state,
      code_challenge: codeChallenge(verifier),
      code_challenge_method: "S256",
    });
    if (provider === "youtube") {
      url = url.withSearchParam("access_type", "offline").withSearchParam("prompt", "consent");
    }
    return ok(url.href);
  }

  async finish(
    provider: ChatOauthProvider,
    requestUrl: string,
    signal: AbortSignal,
  ): Promise<Result<string, ChatOauthError>> {
    const url = rurl(requestUrl);
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    if (state === null || code === null || url.searchParams.has("error")) {
      return erro({ type: "invalid oauth callback", detail: "OAuth callback is incomplete" });
    }
    const attempt = await this.store.consumeOauthAttempt(sha256(state), provider);
    if (!attempt) {
      return erro({ type: "expired oauth attempt", detail: "OAuth attempt expired" });
    }
    const config = this.configs.get(provider);
    if (!config) {
      return erro({
        type: "oauth provider unavailable",
        detail: `OAuth для ${provider} не настроен`,
        returnUrl: attempt.returnUrl,
      });
    }
    const publicUrl = this.publicUrl;
    const store = this.store;
    return await safeTry(async function* () {
      const token = yield* safeFetch(config.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: callbackUrl(publicUrl, provider),
          code_verifier: attempt.verifier,
        }),
        signal,
      })
        .andThen(parseJson)
        .andThen((value) => validate(value, TokenResponseSchema))
        .mapErr(
          (cause): ChatOauthError => ({
            type: "oauth token exchange failed",
            detail: `Не удалось завершить OAuth ${provider}`,
            returnUrl: attempt.returnUrl,
            cause,
          }),
        );
      const providerIdentity = yield* (
        await identity(provider, config.clientId, token.access_token, signal)
      ).mapErr((error): ChatOauthError => ({ ...error, returnUrl: attempt.returnUrl }));
      if (
        !(await store.hasSourceCapacity(attempt.userId, provider, providerIdentity.providerUserId))
      ) {
        return erro({
          type: "chat source limit reached",
          detail: "Достигнут лимит подключённых чат-каналов",
          returnUrl: attempt.returnUrl,
        });
      }
      if (provider === "kick") {
        const broadcasterUserId = Number(providerIdentity.providerUserId);
        if (!Number.isSafeInteger(broadcasterUserId) || broadcasterUserId <= 0) {
          return erro({
            type: "oauth profile failed",
            detail: "Kick вернул некорректный идентификатор канала",
            returnUrl: attempt.returnUrl,
          });
        }
        yield* safeFetch("https://api.kick.com/public/v1/events/subscriptions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            broadcaster_user_id: broadcasterUserId,
            method: "webhook",
            events: [{ name: "chat.message.sent", version: 1 }],
          }),
          signal,
        }).mapErr(
          (cause): ChatOauthError => ({
            type: "oauth profile failed",
            detail: "Не удалось подписаться на события чата Kick",
            returnUrl: attempt.returnUrl,
            cause,
          }),
        );
      }
      await store.saveProviderAccount(
        attempt.userId,
        {
          provider,
          providerUserId: providerIdentity.providerUserId,
          displayName: providerIdentity.displayName,
          accessToken: token.access_token,
          refreshToken: token.refresh_token,
          ...(token.expires_in
            ? { accessTokenExpiresAt: new Date(Date.now() + token.expires_in * 1_000) }
            : {}),
          scopes: normalizedScopes(token.scope, config.scopes),
        },
        {
          provider,
          providerSourceId: providerIdentity.providerUserId,
          displayName: providerIdentity.displayName,
          sourceUrl: providerIdentity.sourceUrl,
        },
      );
      return ok(attempt.returnUrl);
    });
  }
}

export function chatOauthConfigs(
  input: Readonly<{
    youtube?: Readonly<{ clientId: string; clientSecret: string }>;
    twitch?: Readonly<{ clientId: string; clientSecret: string }>;
    kick?: Readonly<{ clientId: string; clientSecret: string }>;
  }>,
): readonly ProviderConfig[] {
  return [
    ...(input.youtube
      ? [
          {
            provider: "youtube" as const,
            clientId: input.youtube.clientId,
            clientSecret: input.youtube.clientSecret,
            authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
            tokenUrl: "https://oauth2.googleapis.com/token",
            scopes: ["https://www.googleapis.com/auth/youtube.force-ssl"],
          },
        ]
      : []),
    ...(input.twitch
      ? [
          {
            provider: "twitch" as const,
            clientId: input.twitch.clientId,
            clientSecret: input.twitch.clientSecret,
            authorizationUrl: "https://id.twitch.tv/oauth2/authorize",
            tokenUrl: "https://id.twitch.tv/oauth2/token",
            scopes: [
              "user:read:chat",
              "user:write:chat",
              "moderator:manage:chat_messages",
              "moderator:manage:banned_users",
            ],
          },
        ]
      : []),
    ...(input.kick
      ? [
          {
            provider: "kick" as const,
            clientId: input.kick.clientId,
            clientSecret: input.kick.clientSecret,
            authorizationUrl: "https://id.kick.com/oauth/authorize",
            tokenUrl: "https://id.kick.com/oauth/token",
            scopes: [
              "user:read",
              "channel:read",
              "events:subscribe",
              "chat:write",
              "moderation:chat_message:manage",
              "moderation:ban",
            ],
          },
        ]
      : []),
  ];
}
