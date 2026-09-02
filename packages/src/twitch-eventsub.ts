import { erro, parseJson, validate } from "@lebedevna/neverthrow-utils";
import { ok, Result } from "neverthrow";
import { z } from "zod";

import { propagateError } from "./neverthrow/propagate-error.js";
import { createResultEventStream, type ResultStream } from "./result-stream.js";

export type TwitchSocketEvent =
  | Readonly<{ type: "welcome"; sessionId: string }>
  | Readonly<{ type: "reconnect"; url: string }>
  | Readonly<{ type: "revocation"; broadcasterId: string; reason: string }>
  | Readonly<{
      type: "message";
      channel: string;
      id: string;
      authorId: string;
      author: string;
      text: string;
      occurredAt: Date;
    }>
  | Readonly<{ type: "error" }>;

export type TwitchOperationError = Readonly<{
  type: "twitch operation error";
  detail: string;
  cause: unknown;
}>;

const WelcomeSchema = z.object({
  metadata: z.object({
    message_type: z.literal("session_welcome"),
  }),
  payload: z.object({
    session: z.object({
      id: z.string(),
    }),
  }),
});

const NotificationSchema = z.object({
  metadata: z.object({
    message_type: z.literal("notification"),
    message_timestamp: z.string(),
  }),
  payload: z.object({
    event: z.object({
      broadcaster_user_login: z.string(),
      chatter_user_id: z.string(),
      chatter_user_name: z.string(),
      message_id: z.string(),
      message: z.object({
        text: z.string(),
      }),
    }),
  }),
});

const ReconnectSchema = z.object({
  metadata: z.object({
    message_type: z.literal("session_reconnect"),
  }),
  payload: z.object({
    session: z.object({
      reconnect_url: z.url(),
    }),
  }),
});

const RevocationSchema = z.object({
  metadata: z.object({
    message_type: z.literal("revocation"),
  }),
  payload: z.object({
    subscription: z.object({
      status: z.string(),
      condition: z.object({
        broadcaster_user_id: z.string(),
      }),
    }),
  }),
});

export function twitchOperationError(detail: string, cause: unknown) {
  return erro.fmt({ type: "twitch operation error" as const, detail, cause });
}

const MessageMetadataSchema = z
  .object({
    metadata: z
      .object({
        message_type: z.string(),
      })
      .passthrough(),
  })
  .passthrough();

function decodeSocketMessage(raw: string) {
  return parseJson(raw)
    .andThen((value) => validate(value, MessageMetadataSchema))
    .andThen((message) => {
      switch (message.metadata.message_type) {
        case "session_welcome":
          return validate(message, WelcomeSchema).map((event) => ({
            type: "welcome" as const,
            sessionId: event.payload.session.id,
          }));
        case "session_reconnect":
          return validate(message, ReconnectSchema).map((event) => ({
            type: "reconnect" as const,
            url: event.payload.session.reconnect_url,
          }));
        case "revocation":
          return validate(message, RevocationSchema).map((event) => ({
            type: "revocation" as const,
            broadcasterId: event.payload.subscription.condition.broadcaster_user_id,
            reason: event.payload.subscription.status,
          }));
        case "notification":
          return validate(message, NotificationSchema).map((notification) => {
            const event = notification.payload.event;
            return {
              type: "message" as const,
              channel: event.broadcaster_user_login.toLowerCase(),
              id: event.message_id,
              authorId: event.chatter_user_id,
              author: event.chatter_user_name,
              text: event.message.text,
              occurredAt: new Date(notification.metadata.message_timestamp),
            };
          });
        case "session_keepalive":
          return ok(null);
        default:
          return ok(null);
      }
    })
    .mapErr((cause) => twitchOperationError("Could not decode the Twitch socket message", cause));
}

export async function* twitchSocketEvents(
  signal: AbortSignal,
  reconnectUrl = "wss://eventsub.wss.twitch.tv/ws",
): ResultStream<TwitchSocketEvent, TwitchOperationError> {
  const $socket = Result.fromThrowable(
    () => new WebSocket(reconnectUrl),
    (cause) => twitchOperationError("Could not open the Twitch connection", cause),
  )();
  if ($socket.isErr()) {
    yield propagateError($socket);
    return;
  }
  const socket = $socket.value;
  yield* createResultEventStream<TwitchSocketEvent, TwitchOperationError>((sink) => {
    const onMessage = (event: MessageEvent) => {
      const $decoded = decodeSocketMessage(String(event.data));
      if ($decoded.isErr()) {
        void sink.fail($decoded.error);
        return;
      }
      if ($decoded.value) {
        void sink.emit($decoded.value);
      }
    };
    const onClose = () => void sink.end();
    const onError = () => void sink.emit({ type: "error" });
    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", onClose);
    socket.addEventListener("error", onError);
    return () => {
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("close", onClose);
      socket.removeEventListener("error", onError);
      const $closed = Result.fromThrowable(
        () => socket.close(),
        (cause) => twitchOperationError("Could not close the Twitch socket", cause),
      )();
      void $closed;
    };
  }, signal);
}
