import type { ChatModerationCommand, ChatProvider } from "@coldbrew/packages/chat.js";
import { createAbortableStream } from "@coldbrew/packages/create-abortable-stream.js";
import { propagateError } from "@coldbrew/packages/neverthrow/propagate-error.js";
import { erro, parseJson, safeFetch, validate } from "@lebedevna/neverthrow-utils";
import { ok, type Result } from "neverthrow";
import { z } from "zod";

import type {
  ChatProviderAdapter,
  ChatProviderCommandContext,
  ChatProviderCommandSuccess,
  ChatProviderOperationError,
  ConnectedChatSource,
} from "./provider.js";
import type { ChatStore } from "./store.js";

const REFRESH_EARLY_MS = 60_000;

type RefreshConfig = Readonly<{
  provider: Extract<ChatProvider, "youtube" | "twitch" | "kick">;
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
}>;

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().positive().optional(),
});

function refreshError(detail: string, cause?: unknown): ChatProviderOperationError {
  return {
    type: "provider unauthorized",
    detail,
    cause,
  };
}

export class ChatTokenRefresher {
  private readonly configs: ReadonlyMap<ChatProvider, RefreshConfig>;

  constructor(
    private readonly store: ChatStore,
    configs: readonly RefreshConfig[],
  ) {
    this.configs = new Map(configs.map((config) => [config.provider, config]));
  }

  async refresh(
    connectedSource: ConnectedChatSource,
    signal: AbortSignal,
  ): Promise<Result<ConnectedChatSource, ChatProviderOperationError>> {
    const expiresAt = connectedSource.credentials.expiresAt;
    if (!expiresAt || expiresAt.getTime() > Date.now() + REFRESH_EARLY_MS) {
      return ok(connectedSource);
    }
    const refreshToken = connectedSource.credentials.refreshToken;
    const config = this.configs.get(connectedSource.source.provider);
    if (!refreshToken || !config) {
      return erro(refreshError("Подключение чата нужно авторизовать заново"));
    }
    const $token = await safeFetch(config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
      signal,
    })
      .andThen(parseJson)
      .andThen((value) => validate(value, TokenResponseSchema));
    if ($token.isErr()) {
      return erro(refreshError("Не удалось обновить авторизацию чата", $token.error));
    }
    const nextRefreshToken = $token.value.refresh_token ?? refreshToken;
    const nextExpiry = $token.value.expires_in
      ? new Date(Date.now() + $token.value.expires_in * 1_000)
      : undefined;
    const nextVersion = await this.store.updateConnectionCredentials(
      connectedSource.source.connectionId,
      connectedSource.credentials.tokenVersion,
      {
        accessToken: $token.value.access_token,
        refreshToken: nextRefreshToken,
        accessTokenExpiresAt: nextExpiry,
      },
    );
    if (!nextVersion) {
      return erro({
        type: "provider unavailable",
        detail: "Авторизация чата уже обновляется другим экземпляром сервиса",
      });
    }
    return ok({
      ...connectedSource,
      credentials: {
        ...connectedSource.credentials,
        accessToken: $token.value.access_token,
        refreshToken: nextRefreshToken,
        expiresAt: nextExpiry,
        tokenVersion: nextVersion,
      },
    });
  }
}

export class RefreshingChatProvider implements ChatProviderAdapter {
  readonly provider: ChatProvider;
  readonly collection: "pull" | "push";

  constructor(
    private readonly delegate: ChatProviderAdapter,
    private readonly refresher: ChatTokenRefresher,
  ) {
    this.provider = delegate.provider;
    this.collection = delegate.collection;
  }

  stream(connectedSource: ConnectedChatSource, parentSignal: AbortSignal) {
    const delegate = this.delegate;
    const refresher = this.refresher;
    return createAbortableStream(async function* (signal) {
      const $source = await refresher.refresh(connectedSource, signal);
      if ($source.isErr()) {
        yield propagateError($source);
        return;
      }
      const expiresAt = $source.value.credentials.expiresAt;
      const refreshSignal = expiresAt
        ? AbortSignal.timeout(Math.max(0, expiresAt.getTime() - Date.now() - REFRESH_EARLY_MS))
        : null;
      yield* delegate.stream(
        $source.value,
        refreshSignal ? AbortSignal.any([signal, refreshSignal]) : signal,
      );
    }, parentSignal);
  }

  async sendMessage(
    connectedSource: ConnectedChatSource,
    text: string,
    signal: AbortSignal,
  ): Promise<Result<void, ChatProviderOperationError>> {
    const $source = await this.refresher.refresh(connectedSource, signal);
    if ($source.isErr()) {
      return propagateError($source);
    }
    return await this.delegate.sendMessage($source.value, text, signal);
  }

  async moderate(
    connectedSource: ConnectedChatSource,
    command: ChatModerationCommand,
    context: ChatProviderCommandContext,
    signal: AbortSignal,
  ): Promise<Result<ChatProviderCommandSuccess, ChatProviderOperationError>> {
    const $source = await this.refresher.refresh(connectedSource, signal);
    if ($source.isErr()) {
      return propagateError($source);
    }
    return await this.delegate.moderate($source.value, command, context, signal);
  }
}

export function tokenRefreshConfigs(
  input: Readonly<{
    youtube?: Readonly<{ clientId: string; clientSecret: string }>;
    twitch?: Readonly<{ clientId: string; clientSecret: string }>;
    kick?: Readonly<{ clientId: string; clientSecret: string }>;
  }>,
): readonly RefreshConfig[] {
  return [
    ...(input.youtube
      ? [
          {
            provider: "youtube" as const,
            ...input.youtube,
            tokenUrl: "https://oauth2.googleapis.com/token",
          },
        ]
      : []),
    ...(input.twitch
      ? [
          {
            provider: "twitch" as const,
            ...input.twitch,
            tokenUrl: "https://id.twitch.tv/oauth2/token",
          },
        ]
      : []),
    ...(input.kick
      ? [
          {
            provider: "kick" as const,
            ...input.kick,
            tokenUrl: "https://id.kick.com/oauth/token",
          },
        ]
      : []),
  ];
}
