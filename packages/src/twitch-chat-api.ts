import { erro, parseJson, safeFetch, validate } from "@lebedevna/neverthrow-utils";
import { rurl } from "@lebedevna/readonly-url";
import { ok, type Result } from "neverthrow";
import { z } from "zod";

import { propagateError } from "./neverthrow/propagate-error.js";
import type { TwitchCredentials } from "./twitch-chat.js";

export type TwitchSubscriptionError = Readonly<{
  type: "rejected" | "unreachable";
}>;

export type TwitchChatApi = Readonly<{
  validateCredentials(
    credentials: TwitchCredentials,
    signal: AbortSignal,
  ): Promise<Result<TwitchCredentials, unknown>>;
  resolveBroadcasterId(
    credentials: TwitchCredentials,
    channel: string,
    signal: AbortSignal,
  ): Promise<Result<string | null, unknown>>;
  createSubscription(
    credentials: TwitchCredentials,
    broadcasterId: string,
    sessionId: string,
    signal: AbortSignal,
  ): Promise<Result<void, TwitchSubscriptionError>>;
}>;

function validateRequest(credentials: TwitchCredentials, signal: AbortSignal) {
  const schema = z.object({
    client_id: z.string(),
    user_id: z.string(),
  });
  return safeFetch("https://id.twitch.tv/oauth2/validate", {
    headers: { Authorization: `OAuth ${credentials.accessToken}` },
    signal,
  })
    .andThen(parseJson)
    .andThen((value) => validate(value, schema));
}

function refreshCredentials(credentials: TwitchCredentials, signal: AbortSignal) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: credentials.refreshToken,
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
  });
  const schema = z.object({
    access_token: z.string(),
    refresh_token: z.string().optional(),
  });
  return safeFetch("https://id.twitch.tv/oauth2/token", { method: "POST", body, signal })
    .andThen(parseJson)
    .andThen((value) => validate(value, schema))
    .map((response) => ({
      ...credentials,
      accessToken: response.access_token,
      refreshToken: response.refresh_token ?? credentials.refreshToken,
    }));
}

async function validateCredentials(
  credentials: TwitchCredentials,
  signal: AbortSignal,
  canRefresh = true,
): Promise<Result<TwitchCredentials, unknown>> {
  const $response = await validateRequest(credentials, signal);
  if (
    $response.isErr() &&
    $response.error.type === "http error" &&
    $response.error.status === 401 &&
    canRefresh
  ) {
    const $credentials = await refreshCredentials(credentials, signal);
    if ($credentials.isErr()) {
      return $credentials;
    }
    return await validateCredentials($credentials.value, signal, false);
  }
  if ($response.isErr()) {
    return propagateError($response);
  }
  if ($response.value.client_id !== credentials.clientId) {
    return erro({ type: "twitch client mismatch" });
  }
  return ok({ ...credentials, botUserId: $response.value.user_id });
}

function twitchHeaders(credentials: TwitchCredentials) {
  return {
    Authorization: `Bearer ${credentials.accessToken}`,
    "Client-Id": credentials.clientId,
  };
}

async function resolveBroadcasterId(
  credentials: TwitchCredentials,
  channel: string,
  signal: AbortSignal,
): Promise<Result<string | null, unknown>> {
  const url = rurl("https://api.twitch.tv/helix/users").withSearchParam("login", channel);
  const schema = z.object({
    data: z.array(
      z.object({
        id: z.string(),
      }),
    ),
  });
  return await safeFetch(url.href, { headers: twitchHeaders(credentials), signal })
    .andThen(parseJson)
    .andThen((value) => validate(value, schema))
    .map((response) => response.data[0]?.id ?? null);
}

async function createSubscription(
  credentials: TwitchCredentials,
  broadcasterId: string,
  sessionId: string,
  signal: AbortSignal,
): Promise<Result<void, TwitchSubscriptionError>> {
  return await safeFetch("https://api.twitch.tv/helix/eventsub/subscriptions", {
    method: "POST",
    headers: { ...twitchHeaders(credentials), "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "channel.chat.message",
      version: "1",
      condition: { broadcaster_user_id: broadcasterId, user_id: credentials.botUserId },
      transport: { method: "websocket", session_id: sessionId },
    }),
    signal,
  })
    .map(() => undefined)
    .mapErr((error) => ({ type: error.type === "http error" ? "rejected" : "unreachable" }));
}

export const twitchChatApi: TwitchChatApi = {
  validateCredentials,
  resolveBroadcasterId,
  createSubscription,
};
