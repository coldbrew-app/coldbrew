import { parseJson, safeFetch, validate } from "@lebedevna/neverthrow-utils";
import { rurl } from "@lebedevna/readonly-url";
import type { ChatMessage, ChatSourceState } from "@web/lib/chat.js";
import delay from "delay";
import { safeTry } from "neverthrow";
import { z } from "zod";

import { env } from "../env.js";

type Emit = {
  message: (message: ChatMessage) => void;
  state: (state: ChatSourceState, detail?: string) => void;
};

class TwitchChatGateway {
  private socket: WebSocket | null = null;
  private sessionId: string | null = null;
  // private accessToken = env.TWITCH_CHAT_ACCESS_TOKEN;
  // private refreshToken = env.TWITCH_CHAT_REFRESH_TOKEN;
  // private botUserId = env.TWITCH_CHAT_USER_ID;
  private readonly channels = new Map<string, { emit: Emit; broadcasterId?: string }>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private validationTimer: ReturnType<typeof setInterval> | null = null;
  private lastValidatedAt = 0;

  constructor(
    private config: {
      accessToken: string;
      refreshToken: string;
      botUserId: string;
      readonly twitchChatClientId: string;
      readonly twitchChatClientSecret: string;
    },
  ) {}

  async subscribe(channel: string, emit: Emit, signal: AbortSignal) {
    this.channels.set(channel, { emit });
    emit.state("connecting");
    await this.ensureConnected();
    if (this.sessionId) await this.createSubscription(channel);

    // TODO: does infinity work?
    await delay(Infinity, { signal });

    this.channels.delete(channel);
    if (this.channels.size === 0) this.disconnect();
  }

  private async ensureConnected() {
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) return;
    const valid = await this.validateToken();
    if (!valid) {
      for (const { emit } of this.channels.values())
        emit.state("error", "Twitch service token is invalid");
      return;
    }
    this.socket = new WebSocket("wss://eventsub.wss.twitch.tv/ws");
    this.socket.addEventListener("message", (event) => void this.onMessage(String(event.data)));
    this.socket.addEventListener("close", () => this.scheduleReconnect());
    this.socket.addEventListener("error", () => {
      for (const { emit } of this.channels.values())
        emit.state("error", "Twitch connection failed");
    });
    if (!this.validationTimer) {
      this.validationTimer = setInterval(
        () => {
          void this.validateToken().then((isValid) => {
            if (!isValid) {
              for (const { emit } of this.channels.values()) {
                emit.state("error", "Twitch service token is invalid");
              }
            }
          });
        },
        60 * 60 * 1000,
      );
    }
  }

  private async onMessage(raw: string) {
    const $json = parseJson(raw);
    if ($json.isErr()) return;

    {
      const schema = z.object({
        metadata: z.object({
          message_type: z.literal("session_welcome"),
        }),
        payload: z.object({
          session: z.object({
            id: z.string(),
          }),
        }),
      });
      const $welcome = $json.andThen((value) => validate(schema, value));
      if ($welcome.isOk()) {
        this.sessionId = $welcome.value.payload.session.id;
        for (const channel of this.channels.keys()) await this.createSubscription(channel);
        return;
      }
    }

    const schema = z.object({
      metadata: z.object({
        message_type: z.literal("notification"),
        message_timestamp: z.string(),
      }),
      payload: z.object({
        event: z.object({
          broadcaster_user_login: z.string(),
          chatter_user_name: z.string(),
          message_id: z.string(),
          message: z.object({
            text: z.string(),
          }),
        }),
      }),
    });
    const $notification = $json.andThen((value) => validate(schema, value));
    if ($notification.isOk()) {
      const event = $notification.value.payload.event;
      const target = this.channels.get(event.broadcaster_user_login.toLowerCase());
      target?.emit.message({
        id: event.message_id,
        provider: "twitch",
        sourceIdentifier: event.broadcaster_user_login.toLowerCase(),
        author: event.chatter_user_name,
        text: event.message.text,
        occurredAt: new Date($notification.value.metadata.message_timestamp),
      });
    }
  }

  private async createSubscription(channel: string) {
    const target = this.channels.get(channel);
    if (!target || !this.sessionId) return;
    if (!target.broadcasterId) {
      const url = rurl("https://api.twitch.tv/helix/users").withSearchParam("login", channel);
      const schema = z.object({
        data: z.array(
          z.object({
            id: z.string(),
            login: z.string(),
          }),
        ),
      });
      const $response = await safeFetch(url.href, { headers: this.headers() })
        .andThen(parseJson)
        .andThen((value) => validate(schema, value));
      if ($response.isErr()) {
        target.emit.state("error", "Could not find this Twitch channel");
        return;
      }
      target.broadcasterId = $response.value.data[0]?.id;
    }
    if (!target.broadcasterId) {
      target.emit.state("offline", "Twitch channel not found");
      return;
    }
    const $response = await safeFetch("https://api.twitch.tv/helix/eventsub/subscriptions", {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "channel.chat.message",
        version: "1",
        condition: { broadcaster_user_id: target.broadcasterId, user_id: this.config.botUserId },
        transport: { method: "websocket", session_id: this.sessionId },
      }),
    });
    if ($response.isOk()) {
      target.emit.state("live");
    } else if ($response.error.type === "http error") {
      target.emit.state("error", "Twitch rejected the chat subscription");
    } else {
      target.emit.state("error", "Could not reach Twitch");
    }
  }

  private headers() {
    return {
      Authorization: `Bearer ${this.config.accessToken}`,
      "Client-Id": this.config.twitchChatClientId,
    };
  }

  private async validateToken() {
    if (Date.now() - this.lastValidatedAt < 60 * 60 * 1000) return true;
    const schema = z.object({
      client_id: z.string(),
      user_id: z.string(),
      expires_in: z.number(),
    });
    const request = () =>
      safeFetch("https://id.twitch.tv/oauth2/validate", {
        headers: { Authorization: `OAuth ${this.config.accessToken}` },
      })
        .andThen(parseJson)
        .andThen((value) => validate(schema, value));
    const self = this;
    const $response = await safeTry(async function* () {
      let $response = await request();
      if (
        $response.isErr() &&
        $response.error.type === "http error" &&
        $response.error.status === 401
      ) {
        yield* self.refreshAccessToken();
        $response = await request();
      }

      return $response;
    });
    if ($response.isErr()) return false;
    if ($response.value.client_id !== env.TWITCH_CHAT_CLIENT_ID) return false;
    this.config.botUserId = $response.value.user_id;
    this.lastValidatedAt = Date.now();
    return true;
  }

  private refreshAccessToken() {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.config.refreshToken,
      client_id: this.config.twitchChatClientId,
      client_secret: this.config.twitchChatClientSecret,
    });
    const schema = z.object({
      access_token: z.string(),
      refresh_token: z.string().optional(),
    });
    return safeFetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      body,
    })
      .andThen(parseJson)
      .andThen((value) => validate(schema, value))
      .map((response) => {
        this.config.accessToken = response.access_token;
        this.config.refreshToken = response.refresh_token ?? this.config.refreshToken;
      });
  }

  private scheduleReconnect() {
    this.socket = null;
    this.sessionId = null;
    if (this.channels.size === 0 || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.ensureConnected();
    }, 1500);
  }

  private disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.validationTimer) clearInterval(this.validationTimer);
    this.reconnectTimer = null;
    this.validationTimer = null;
    this.socket?.close();
    this.socket = null;
    this.sessionId = null;
  }
}

export const twitchChatGateway = new TwitchChatGateway({
  accessToken: env.TWITCH_CHAT_ACCESS_TOKEN!,
  refreshToken: env.TWITCH_CHAT_REFRESH_TOKEN!,
  botUserId: env.TWITCH_CHAT_USER_ID!,
  twitchChatClientId: env.TWITCH_CHAT_CLIENT_ID!,
  twitchChatClientSecret: env.TWITCH_CHAT_CLIENT_SECRET!,
});
