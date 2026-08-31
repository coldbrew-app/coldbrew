import { delay } from "@lebedevna/delay";
import { erro } from "@lebedevna/neverthrow-utils";
import Emittery from "emittery";
import { ok, ResultAsync, type Result as NeverthrowResult } from "neverthrow";

import { createAbortableStream } from "./create-abortable-stream.js";
import type { ResultStream } from "./result-stream.js";
import { twitchChatApi, type TwitchChatApi } from "./twitch-chat-api.js";
import {
  twitchOperationError,
  twitchSocketEvents,
  type TwitchOperationError,
  type TwitchSocketEvent,
} from "./twitch-eventsub.js";

const RECONNECT_DELAY_MS = 1_500;
const VALIDATION_INTERVAL_MS = 60 * 60 * 1_000;
const MAX_SUBSCRIPTIONS_PER_SOCKET = 300;

export type TwitchCredentials = Readonly<{
  accessToken: string;
  refreshToken: string;
  botUserId: string;
  clientId: string;
  clientSecret: string;
}>;

type TwitchChatState = "connecting" | "live" | "offline";
type TwitchInternalState = TwitchChatState | "error";

export type TwitchChatEvent =
  | Readonly<{
      type: "state";
      channel: string;
      state: TwitchChatState;
      reason?: "channel_not_found";
    }>
  | Readonly<{
      type: "message";
      channel: string;
      id: string;
      authorId: string;
      author: string;
      text: string;
      occurredAt: Date;
    }>;

export type TwitchChatError = Readonly<{
  type: "twitch chat error";
  operation: "credentials" | "channel" | "subscription" | "socket" | "read" | "wait";
  channel: string;
  isAbort: boolean;
  cause: unknown;
}>;

type TwitchChannelState = Readonly<{
  owners: ReadonlySet<symbol>;
  broadcasterId?: string;
  subscribedSessionId?: string;
  subscribingSessionId?: string;
  status: TwitchInternalState;
  detail?: string;
}>;

type TwitchState = Readonly<{
  credentials: TwitchCredentials;
  channels: ReadonlyMap<string, TwitchChannelState>;
  sessionId?: string;
  lastValidatedAt: number;
}>;

type TwitchAction =
  | Readonly<{ type: "register"; channel: string; owner: symbol }>
  | Readonly<{ type: "unregister"; channel: string; owner: symbol }>
  | Readonly<{ type: "credentials validated"; credentials: TwitchCredentials; at: number }>
  | Readonly<{ type: "session opened"; sessionId: string }>
  | Readonly<{ type: "session closed" }>
  | Readonly<{ type: "subscription revoked"; channel: string; detail: string }>
  | Readonly<{ type: "subscription started"; channel: string; sessionId: string }>
  | Readonly<{
      type: "subscription finished";
      channel: string;
      sessionId: string;
      status: TwitchInternalState;
      detail?: string;
      broadcasterId?: string;
    }>;

type TwitchDependencies = TwitchChatApi &
  Readonly<{
    now(): number;
    wait(
      milliseconds: number,
      signal: AbortSignal,
    ): Promise<NeverthrowResult<void, TwitchOperationError>>;
    socketEvents(
      signal: AbortSignal,
      reconnectUrl?: string,
    ): ResultStream<TwitchSocketEvent, TwitchOperationError>;
  }>;

type TwitchRun = Readonly<{
  generation: symbol;
  controller: AbortController;
  task: Promise<void>;
}>;

type TwitchRuntime = {
  state: TwitchState;
  events: Emittery<{
    event: NeverthrowResult<TwitchChatEvent, TwitchChatError>;
  }>;
  run: TwitchRun | null;
  validation: Promise<boolean> | null;
};

function replaceChannel(
  channels: ReadonlyMap<string, TwitchChannelState>,
  channel: string,
  state: TwitchChannelState,
) {
  return new Map([...channels].map(([key, value]) => [key, key === channel ? state : value]));
}

export function reduceTwitchState(state: TwitchState, action: TwitchAction): TwitchState {
  if (action.type === "credentials validated") {
    return { ...state, credentials: action.credentials, lastValidatedAt: action.at };
  }
  if (action.type === "session opened") {
    return { ...state, sessionId: action.sessionId };
  }
  if (action.type === "session closed") {
    return {
      ...state,
      sessionId: undefined,
      channels: new Map(
        [...state.channels].map(([channel, value]) => [
          channel,
          {
            ...value,
            subscribedSessionId: undefined,
            subscribingSessionId: undefined,
          },
        ]),
      ),
    };
  }
  if (action.type === "register") {
    const current = state.channels.get(action.channel);
    const owners = new Set([...(current?.owners ?? []), action.owner]);
    return {
      ...state,
      channels: new Map([
        ...[...state.channels].filter(([channel]) => channel !== action.channel),
        [
          action.channel,
          {
            ...current,
            owners,
            status: current?.status ?? "connecting",
          },
        ],
      ]),
    };
  }
  if (action.type === "unregister") {
    const current = state.channels.get(action.channel);
    if (!current) return state;
    const owners = new Set([...current.owners].filter((owner) => owner !== action.owner));
    if (owners.size === 0) {
      return {
        ...state,
        channels: new Map([...state.channels].filter(([channel]) => channel !== action.channel)),
      };
    }
    return {
      ...state,
      channels: replaceChannel(state.channels, action.channel, { ...current, owners }),
    };
  }
  const current = state.channels.get(action.channel);
  if (!current) return state;
  if (action.type === "subscription revoked") {
    return {
      ...state,
      channels: replaceChannel(state.channels, action.channel, {
        ...current,
        subscribedSessionId: undefined,
        subscribingSessionId: undefined,
        status: "error",
        detail: action.detail,
      }),
    };
  }

  if (action.type === "subscription started") {
    return {
      ...state,
      channels: replaceChannel(state.channels, action.channel, {
        ...current,
        subscribingSessionId: action.sessionId,
        status: "connecting",
        detail: undefined,
      }),
    };
  }
  if (current.subscribingSessionId !== action.sessionId) return state;
  return {
    ...state,
    channels: replaceChannel(state.channels, action.channel, {
      ...current,
      broadcasterId: action.broadcasterId ?? current.broadcasterId,
      subscribedSessionId: action.status === "live" ? action.sessionId : undefined,
      subscribingSessionId: undefined,
      status: action.status,
      ...(action.detail ? { detail: action.detail } : { detail: undefined }),
    }),
  };
}

function updateTwitchState(runtime: TwitchRuntime, action: TwitchAction) {
  runtime.state = reduceTwitchState(runtime.state, action);
}

function stateEvent(
  channel: string,
  state: TwitchChatState,
  reason?: "channel_not_found",
): TwitchChatEvent {
  return {
    type: "state",
    channel,
    state,
    ...(reason ? { reason } : {}),
  };
}

async function publishState(
  runtime: TwitchRuntime,
  channel: string,
  state: TwitchChatState,
  reason?: "channel_not_found",
) {
  return await ResultAsync.fromPromise(
    runtime.events.emit("event", ok(stateEvent(channel, state, reason))),
    (cause) => twitchOperationError("Could not publish Twitch state", cause),
  );
}

async function publishError(
  runtime: TwitchRuntime,
  channel: string,
  operation: TwitchChatError["operation"],
  cause: unknown,
  isAbort = false,
) {
  return await ResultAsync.fromPromise(
    runtime.events.emit(
      "event",
      erro({ type: "twitch chat error", operation, channel, isAbort, cause }),
    ),
    (publishCause) => twitchOperationError("Could not publish a Twitch error", publishCause),
  );
}

const defaultDependencies: TwitchDependencies = {
  now: Date.now,
  wait: async (milliseconds, signal) => {
    await delay(milliseconds, { signal });
    return ok(undefined);
  },
  socketEvents: twitchSocketEvents,
  ...twitchChatApi,
};

async function validateRuntime(
  runtime: TwitchRuntime,
  dependencies: TwitchDependencies,
  signal: AbortSignal,
) {
  const state = runtime.state;
  if (dependencies.now() - state.lastValidatedAt < VALIDATION_INTERVAL_MS) return true;
  const $credentials = await dependencies.validateCredentials(state.credentials, signal);
  if ($credentials.isErr()) {
    for (const channel of state.channels.keys()) {
      await publishError(runtime, channel, "credentials", $credentials.error, signal.aborted);
    }
    return false;
  }
  updateTwitchState(runtime, {
    type: "credentials validated",
    credentials: $credentials.value,
    at: dependencies.now(),
  });
  return true;
}

function isCurrentSubscription(runtime: TwitchRuntime, channel: string, sessionId: string) {
  return runtime.state.channels.get(channel)?.subscribingSessionId === sessionId;
}

async function ensureValidCredentials(
  runtime: TwitchRuntime,
  dependencies: TwitchDependencies,
  signal: AbortSignal,
) {
  if (runtime.validation) return await runtime.validation;
  const validation = validateRuntime(runtime, dependencies, signal);
  runtime.validation = validation;
  try {
    return await validation;
  } finally {
    if (runtime.validation === validation) runtime.validation = null;
  }
}

async function subscribeChannel(
  runtime: TwitchRuntime,
  dependencies: TwitchDependencies,
  channel: string,
  signal: AbortSignal,
) {
  const state = runtime.state;
  const target = state.channels.get(channel);
  const sessionId = state.sessionId;
  if (
    !target ||
    !sessionId ||
    target.subscribedSessionId === sessionId ||
    target.subscribingSessionId === sessionId
  ) {
    return;
  }
  const activeSubscriptions = [...state.channels.values()].filter(
    (value) => value.subscribedSessionId === sessionId || value.subscribingSessionId === sessionId,
  ).length;
  if (activeSubscriptions >= MAX_SUBSCRIPTIONS_PER_SOCKET) {
    await publishError(runtime, channel, "subscription", {
      type: "twitch subscription limit",
      limit: MAX_SUBSCRIPTIONS_PER_SOCKET,
    });
    return;
  }
  updateTwitchState(runtime, { type: "subscription started", channel, sessionId });

  let broadcasterId = target.broadcasterId;
  if (!broadcasterId) {
    const $broadcasterId = await dependencies.resolveBroadcasterId(
      runtime.state.credentials,
      channel,
      signal,
    );
    if (!isCurrentSubscription(runtime, channel, sessionId)) return;
    if ($broadcasterId.isErr()) {
      updateTwitchState(runtime, {
        type: "subscription finished",
        channel,
        sessionId,
        status: "error",
        detail: "Could not find this Twitch channel",
      });
      await publishError(runtime, channel, "channel", $broadcasterId.error, signal.aborted);
      return;
    }
    broadcasterId = $broadcasterId.value ?? undefined;
  }
  if (!broadcasterId) {
    updateTwitchState(runtime, {
      type: "subscription finished",
      channel,
      sessionId,
      status: "offline",
      detail: "Twitch channel not found",
    });
    await publishState(runtime, channel, "offline", "channel_not_found");
    return;
  }

  const $subscription = await dependencies.createSubscription(
    runtime.state.credentials,
    broadcasterId,
    sessionId,
    signal,
  );
  if (!isCurrentSubscription(runtime, channel, sessionId)) return;
  const status = $subscription.isOk() ? "live" : "error";
  const detail = $subscription.isErr()
    ? $subscription.error.type === "rejected"
      ? "Twitch rejected the chat subscription"
      : "Could not reach Twitch"
    : undefined;
  updateTwitchState(runtime, {
    type: "subscription finished",
    channel,
    sessionId,
    broadcasterId,
    status,
    ...(detail ? { detail } : {}),
  });
  if ($subscription.isErr()) {
    await publishError(runtime, channel, "subscription", $subscription.error, signal.aborted);
  } else {
    await publishState(runtime, channel, "live");
  }
}

async function handleSocketEvent(
  runtime: TwitchRuntime,
  dependencies: TwitchDependencies,
  event: TwitchSocketEvent,
  signal: AbortSignal,
) {
  if (event.type === "welcome") {
    updateTwitchState(runtime, { type: "session opened", sessionId: event.sessionId });
    for (const channel of runtime.state.channels.keys()) {
      await subscribeChannel(runtime, dependencies, channel, signal);
    }
    return;
  }
  if (event.type === "reconnect") return;
  if (event.type === "revocation") {
    for (const [channel, state] of runtime.state.channels) {
      if (state.broadcasterId !== event.broadcasterId) continue;
      updateTwitchState(runtime, {
        type: "subscription revoked",
        channel,
        detail: event.reason,
      });
      await publishError(runtime, channel, "subscription", event, signal.aborted);
    }
    return;
  }
  if (event.type === "error") {
    for (const channel of runtime.state.channels.keys()) {
      await publishError(runtime, channel, "socket", event, signal.aborted);
    }
    return;
  }
  if (!runtime.state.channels.has(event.channel)) return;
  await ResultAsync.fromPromise(
    runtime.events.emit(
      "event",
      ok({
        type: "message",
        channel: event.channel,
        id: event.id,
        authorId: event.authorId,
        author: event.author,
        text: event.text,
        occurredAt: event.occurredAt,
      }),
    ),
    (cause) => twitchOperationError("Could not publish a Twitch message", cause),
  );
}

async function runTwitchConnection(
  runtime: TwitchRuntime,
  dependencies: TwitchDependencies,
  generation: symbol,
  signal: AbortSignal,
) {
  let reconnectUrl: string | undefined;
  while (!signal.aborted && runtime.state.channels.size > 0) {
    if (!(await ensureValidCredentials(runtime, dependencies, signal))) return;
    let shouldReconnectImmediately = false;
    for await (const $event of dependencies.socketEvents(signal, reconnectUrl)) {
      if (runtime.run?.generation !== generation) return;
      if ($event.isErr()) {
        if (signal.aborted) return;
        for (const channel of runtime.state.channels.keys()) {
          await publishError(runtime, channel, "socket", $event.error, signal.aborted);
        }
        break;
      }
      if ($event.value.type === "reconnect") {
        reconnectUrl = $event.value.url;
        shouldReconnectImmediately = true;
        break;
      }
      await handleSocketEvent(runtime, dependencies, $event.value, signal);
    }
    updateTwitchState(runtime, { type: "session closed" });
    if (signal.aborted || runtime.state.channels.size === 0) return;
    if (shouldReconnectImmediately) continue;
    reconnectUrl = undefined;
    const $waited = await dependencies.wait(RECONNECT_DELAY_MS, signal);
    if ($waited.isErr()) {
      if (!signal.aborted) {
        for (const channel of runtime.state.channels.keys()) {
          await publishError(runtime, channel, "wait", $waited.error, signal.aborted);
        }
      }
      return;
    }
  }
}

async function runTwitchValidation(
  runtime: TwitchRuntime,
  dependencies: TwitchDependencies,
  signal: AbortSignal,
) {
  while (!signal.aborted) {
    const $waited = await dependencies.wait(VALIDATION_INTERVAL_MS, signal);
    if ($waited.isErr()) return;
    if (runtime.state.channels.size === 0) return;
    await ensureValidCredentials(runtime, dependencies, signal);
  }
}

async function ownTwitchRun(
  runtime: TwitchRuntime,
  dependencies: TwitchDependencies,
  generation: symbol,
  controller: AbortController,
) {
  try {
    const connection = runTwitchConnection(runtime, dependencies, generation, controller.signal);
    const validation = runTwitchValidation(runtime, dependencies, controller.signal);
    await connection;
    controller.abort();
    await Promise.allSettled([validation]);
  } finally {
    if (runtime.run?.generation === generation) runtime.run = null;
  }
}

function ensureTwitchConnection(runtime: TwitchRuntime, dependencies: TwitchDependencies) {
  if (runtime.run && !runtime.run.controller.signal.aborted) return;
  const generation = Symbol("twitch connection");
  const controller = new AbortController();
  const run: TwitchRun = { generation, controller, task: Promise.resolve() };
  runtime.run = run;
  const task = ownTwitchRun(runtime, dependencies, generation, controller);
  runtime.run = { ...run, task };
}

async function stopTwitchConnection(runtime: TwitchRuntime) {
  const run = runtime.run;
  if (!run) return;
  run.controller.abort();
  await Promise.allSettled([run.task]);
}

function createTwitchRuntime(credentials: TwitchCredentials): TwitchRuntime {
  return {
    state: {
      credentials,
      channels: new Map(),
      lastValidatedAt: 0,
    },
    events: new Emittery(),
    run: null,
    validation: null,
  };
}

export class TwitchChatClient {
  readonly stream: (
    channel: string,
    parentSignal?: AbortSignal,
  ) => ResultStream<TwitchChatEvent, TwitchChatError>;

  constructor(credentials: TwitchCredentials) {
    const dependencies = defaultDependencies;
    const runtime = createTwitchRuntime(credentials);
    this.stream = (channel, parentSignal) =>
      createAbortableStream(async function* (signal) {
        const owner = Symbol(channel);
        const iterator = runtime.events.events("event", { signal });
        updateTwitchState(runtime, { type: "register", channel, owner });
        ensureTwitchConnection(runtime, dependencies);
        const current = runtime.state.channels.get(channel);

        try {
          yield ok(
            stateEvent(
              channel,
              current?.status === "error" ? "connecting" : (current?.status ?? "connecting"),
            ),
          );
          if (runtime.state.sessionId) {
            await subscribeChannel(
              runtime,
              dependencies,
              channel,
              runtime.run?.controller.signal ?? signal,
            );
          }
          while (!signal.aborted) {
            const $next = await ResultAsync.fromPromise(iterator.next(), (cause) =>
              twitchOperationError("Could not read a Twitch provider event", cause),
            );
            if ($next.isErr()) {
              if (signal.aborted) return;
              yield erro({
                type: "twitch chat error",
                operation: "read",
                channel,
                isAbort: signal.aborted,
                cause: $next.error,
              });
              return;
            }
            if ($next.value.done) return;
            const $data = $next.value.value.data;
            if ($data.isErr()) {
              if ($data.error.channel === channel) yield $data;
              continue;
            }
            if ($data.value.channel === channel) yield ok($data.value);
          }
        } finally {
          if (iterator.return) {
            await ResultAsync.fromPromise(iterator.return(), (cause) =>
              twitchOperationError("Could not close a Twitch provider stream", cause),
            );
          }
          updateTwitchState(runtime, { type: "unregister", channel, owner });
          if (runtime.state.channels.size === 0) await stopTwitchConnection(runtime);
        }
      }, parentSignal);
  }
}
