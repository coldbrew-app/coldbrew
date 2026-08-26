import type { ChatMessage, ChatSourceState } from "@web/lib/chat.js";
import { ResultAsync } from "neverthrow";
import { z } from "zod";

import { env } from "../env.js";

type Emit = {
  message: (message: ChatMessage) => void;
  state: (state: ChatSourceState, detail?: string) => void;
};

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
      chatter_user_name: z.string(),
      message_id: z.string(),
      message: z.object({
        text: z.string(),
      }),
    }),
  }),
});
const UsersResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      login: z.string(),
    }),
  ),
});
const TokenValidationSchema = z.object({
  client_id: z.string(),
  user_id: z.string(),
  expires_in: z.number(),
});
const TokenRefreshSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
});

class TwitchChatGateway {
  private socket: WebSocket | null = null;
  private sessionId: string | null = null;
  private accessToken = env.TWITCH_CHAT_ACCESS_TOKEN;
  private refreshToken = env.TWITCH_CHAT_REFRESH_TOKEN;
  private botUserId = env.TWITCH_CHAT_USER_ID;
  private readonly channels = new Map<string, { emit: Emit; broadcasterId?: string }>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private validationTimer: ReturnType<typeof setInterval> | null = null;
  private lastValidatedAt = 0;

  async subscribe(channel: string, emit: Emit, signal: AbortSignal) {
    this.channels.set(channel, { emit });
    emit.state("connecting");
    await this.ensureConnected();
    if (this.sessionId) await this.createSubscription(channel);
    await new Promise<void>((resolve) =>
      signal.addEventListener("abort", () => resolve(), { once: true }),
    );
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
    const $json = ResultAsync.fromThrowable(
      async () => JSON.parse(raw) as unknown,
      (error) => error,
    )();
    const parsedJson = await $json;
    if (parsedJson.isErr()) return;
    const welcome = WelcomeSchema.safeParse(parsedJson.value);
    if (welcome.success) {
      this.sessionId = welcome.data.payload.session.id;
      for (const channel of this.channels.keys()) await this.createSubscription(channel);
      return;
    }
    const notification = NotificationSchema.safeParse(parsedJson.value);
    if (!notification.success) return;
    const event = notification.data.payload.event;
    const target = this.channels.get(event.broadcaster_user_login.toLowerCase());
    target?.emit.message({
      id: event.message_id,
      provider: "twitch",
      sourceIdentifier: event.broadcaster_user_login.toLowerCase(),
      author: event.chatter_user_name,
      text: event.message.text,
      occurredAt: new Date(notification.data.metadata.message_timestamp),
    });
  }

  private async createSubscription(channel: string) {
    const target = this.channels.get(channel);
    if (
      !target ||
      !this.sessionId ||
      !this.accessToken ||
      !this.botUserId ||
      !env.TWITCH_CHAT_CLIENT_ID
    )
      return;
    if (!target.broadcasterId) {
      const url = new URL("https://api.twitch.tv/helix/users");
      url.searchParams.set("login", channel);
      const $response = await ResultAsync.fromPromise(
        fetch(url, { headers: this.headers() }),
        (error) => error,
      );
      if ($response.isErr() || !$response.value.ok) {
        target.emit.state("error", "Could not find this Twitch channel");
        return;
      }
      const $json = await ResultAsync.fromPromise($response.value.json(), (error) => error);
      const parsed = $json.isOk() ? UsersResponseSchema.safeParse($json.value) : null;
      target.broadcasterId = parsed?.success ? parsed.data.data[0]?.id : undefined;
    }
    if (!target.broadcasterId) {
      target.emit.state("offline", "Twitch channel not found");
      return;
    }
    const $response = await ResultAsync.fromPromise(
      fetch("https://api.twitch.tv/helix/eventsub/subscriptions", {
        method: "POST",
        headers: { ...this.headers(), "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "channel.chat.message",
          version: "1",
          condition: { broadcaster_user_id: target.broadcasterId, user_id: this.botUserId },
          transport: { method: "websocket", session_id: this.sessionId },
        }),
      }),
      (error) => error,
    );
    if ($response.isOk() && $response.value.ok) target.emit.state("live");
    else target.emit.state("error", "Twitch rejected the chat subscription");
  }

  private headers() {
    return {
      Authorization: `Bearer ${this.accessToken}`,
      "Client-Id": env.TWITCH_CHAT_CLIENT_ID,
    };
  }

  private async validateToken() {
    if (!this.accessToken || !env.TWITCH_CHAT_CLIENT_ID) return false;
    if (Date.now() - this.lastValidatedAt < 60 * 60 * 1000) return true;
    const request = () =>
      fetch("https://id.twitch.tv/oauth2/validate", {
        headers: { Authorization: `OAuth ${this.accessToken}` },
      });
    let $response = await ResultAsync.fromPromise(request(), (error) => error);
    if ($response.isOk() && $response.value.status === 401 && (await this.refreshAccessToken())) {
      $response = await ResultAsync.fromPromise(request(), (error) => error);
    }
    if ($response.isErr() || !$response.value.ok) return false;
    const $json = await ResultAsync.fromPromise($response.value.json(), (error) => error);
    const parsed = $json.isOk() ? TokenValidationSchema.safeParse($json.value) : null;
    if (!parsed?.success || parsed.data.client_id !== env.TWITCH_CHAT_CLIENT_ID) return false;
    this.botUserId = parsed.data.user_id;
    this.lastValidatedAt = Date.now();
    return true;
  }

  private async refreshAccessToken() {
    if (!this.refreshToken || !env.TWITCH_CHAT_CLIENT_SECRET || !env.TWITCH_CHAT_CLIENT_ID)
      return false;
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.refreshToken,
      client_id: env.TWITCH_CHAT_CLIENT_ID,
      client_secret: env.TWITCH_CHAT_CLIENT_SECRET,
    });
    const $response = await ResultAsync.fromPromise(
      fetch("https://id.twitch.tv/oauth2/token", { method: "POST", body }),
      (error) => error,
    );
    if ($response.isErr() || !$response.value.ok) return false;
    const $json = await ResultAsync.fromPromise($response.value.json(), (error) => error);
    const parsed = $json.isOk() ? TokenRefreshSchema.safeParse($json.value) : null;
    if (!parsed?.success) return false;
    this.accessToken = parsed.data.access_token;
    this.refreshToken = parsed.data.refresh_token ?? this.refreshToken;
    return true;
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

export const twitchChatGateway = new TwitchChatGateway();
