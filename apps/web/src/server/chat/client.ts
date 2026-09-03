import {
  ChatBroadcastResultSchema,
  ChatCommandResultSchema,
  ChatConfigSchema,
  ChatProviderAvailabilitySchema,
  ChatStreamEventSchema,
  type ChatModerationCommand,
  type ChatProvider,
  type ChatStreamEvent,
} from "@coldbrew/packages/chat.js";
import { parseJson, RequestError, requestJson } from "@coldbrew/packages/http.js";
import { rurl } from "@lebedevna/readonly-url";
import { z } from "zod";

import { env } from "../env.js";

export class ChatServiceError extends Error {
  readonly type = "chat service error";
  readonly detail: string;
  readonly status?: number;

  constructor(detail: string, options: ErrorOptions & { status?: number } = {}) {
    super(`Chat service ${detail}.`, options);
    this.name = "ChatServiceError";
    this.detail = detail;
    this.status = options.status;
  }
}

const AuthorizationUrlSchema = z.object({
  authorizationUrl: z.url(),
});

function serviceUrl(path: string) {
  return rurl(path, env.CHAT_SERVICE_URL);
}

function serviceHeaders() {
  return {
    Authorization: `Bearer ${env.CHAT_SERVICE_SECRET}`,
    "Content-Type": "application/json",
  };
}

function toServiceError(cause: unknown): ChatServiceError {
  if (cause instanceof RequestError) {
    return new ChatServiceError(cause.type, { cause, status: cause.status });
  }
  return new ChatServiceError("unexpected error", { cause });
}

async function request<Output>(path: string, schema: z.ZodType<Output>, body?: unknown) {
  try {
    return await requestJson(serviceUrl(path).href, schema, {
      method: body === undefined ? "GET" : "POST",
      headers: serviceHeaders(),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (cause) {
    throw toServiceError(cause);
  }
}

function parseStreamEvent(line: string): ChatStreamEvent {
  try {
    return parseJson(line, ChatStreamEventSchema);
  } catch (cause) {
    throw toServiceError(cause);
  }
}

export const chatService = {
  config(userId: number) {
    return request("/internal/config", ChatConfigSchema, { userId });
  },

  providerAvailability() {
    return request("/internal/provider-availability", z.array(ChatProviderAvailabilitySchema));
  },

  startOauth(userId: number, provider: Extract<ChatProvider, "youtube" | "twitch" | "kick">) {
    return request("/internal/oauth/start", AuthorizationUrlSchema, { provider, userId });
  },

  disconnect(userId: number, connectionId: string) {
    return request("/internal/connections/disconnect", z.null(), { connectionId, userId });
  },

  refreshSource(userId: number, sourceId: string) {
    return request("/internal/sources/refresh", z.null(), { sourceId, userId });
  },

  broadcast(userId: number, text: string) {
    return request("/internal/broadcast", ChatBroadcastResultSchema, { text, userId });
  },

  moderate(userId: number, command: ChatModerationCommand) {
    return request("/internal/moderate", ChatCommandResultSchema, { command, userId });
  },

  async *stream(userId: number, signal: AbortSignal): AsyncIterable<ChatStreamEvent> {
    const url = serviceUrl("/internal/stream").withSearchParam("userId", userId);
    let response: Response;
    try {
      response = await fetch(url.href, { headers: serviceHeaders(), signal });
    } catch (cause) {
      if (signal.aborted) {
        return;
      }
      throw new ChatServiceError("fetch error", { cause });
    }
    if (!response.ok) {
      throw new ChatServiceError("http error", { status: response.status });
    }
    if (response.body === null) {
      throw new ChatServiceError("missing response body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (!signal.aborted) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch (cause) {
          if (signal.aborted) {
            return;
          }
          throw new ChatServiceError("stream read error", { cause });
        }
        buffer += decoder.decode(chunk.value, { stream: !chunk.done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.length === 0) {
            continue;
          }
          yield parseStreamEvent(line);
        }
        if (chunk.done) {
          if (buffer.length > 0) {
            yield parseStreamEvent(buffer);
          }
          return;
        }
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  },
};
