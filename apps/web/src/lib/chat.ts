import { erro } from "@lebedevna/neverthrow-utils";
import { rurl, type ReadonlyURL } from "@lebedevna/readonly-url";
import { ok, Result } from "neverthrow";
import { z } from "zod";

export const ChatProviderSchema = z.enum(["youtube", "twitch"]);
export type ChatProvider = z.infer<typeof ChatProviderSchema>;

export const ChatSourceSchema = z.object({
  provider: ChatProviderSchema,
  sourceIdentifier: z.string().min(1).max(100),
  sourceUrl: z.url(),
});
export type ChatSource = z.infer<typeof ChatSourceSchema>;

export const MAX_CHAT_SOURCES = 8;

export type ChatSourceInputError = Readonly<{
  type: "chat source input error";
  reason: "unsupported" | "duplicate" | "limit";
}>;

export const ChatMessageSchema = z.object({
  id: z.string(),
  provider: ChatProviderSchema,
  sourceIdentifier: z.string(),
  author: z.string(),
  text: z.string(),
  occurredAt: z.date(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export function chatSourceKey(source: Pick<ChatSource, "provider" | "sourceIdentifier">) {
  return `${source.provider}:${source.sourceIdentifier}`;
}

export function chatMessageKey(message: Pick<ChatMessage, "provider" | "sourceIdentifier" | "id">) {
  return `${chatSourceKey(message)}:${message.id}`;
}

export const ChatSourceStateSchema = z.enum(["connecting", "live", "offline", "error"]);
export type ChatSourceState = z.infer<typeof ChatSourceStateSchema>;

export const ChatConnectionErrorCodeSchema = z.enum([
  "session_limit",
  "configuration_unavailable",
  "overlay_not_found",
  "stream_unavailable",
  "transport_unavailable",
]);
export type ChatConnectionErrorCode = z.infer<typeof ChatConnectionErrorCodeSchema>;

export const ChatConnectionErrorSchema = z.object({
  code: ChatConnectionErrorCodeSchema,
  detail: z.string(),
});
export type ChatConnectionError = z.infer<typeof ChatConnectionErrorSchema>;

export const ChatStreamEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("message"),
    message: ChatMessageSchema,
  }),
  z.object({
    type: z.literal("state"),
    provider: ChatProviderSchema,
    sourceIdentifier: z.string(),
    state: ChatSourceStateSchema,
    detail: z.string().optional(),
  }),
  z.object({
    type: z.literal("connection_error"),
    error: ChatConnectionErrorSchema,
  }),
]);
export type ChatStreamEvent = z.infer<typeof ChatStreamEventSchema>;

const youtubeId = /^[A-Za-z0-9_-]{11}$/;
const twitchChannel = /^[a-z0-9_]{3,25}$/;
const twitchReservedPaths = new Set([
  "directory",
  "downloads",
  "inventory",
  "jobs",
  "p",
  "settings",
  "subscriptions",
  "videos",
  "wallet",
]);

function parseUrl(value: string) {
  const $url = Result.fromThrowable(
    () => rurl(value.trim()),
    () => null,
  )();
  if ($url.isErr()) return null;
  const url: ReadonlyURL = $url.value;
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  return url;
}

function parseYoutubeChatUrl(url: ReadonlyURL): ChatSource | null {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "youtu.be") {
    const parts = url.pathname.split("/").filter(Boolean);
    const id = parts.length === 1 ? parts[0] : null;
    return id && youtubeId.test(id)
      ? { provider: "youtube", sourceIdentifier: id, sourceUrl: `https://youtu.be/${id}` }
      : null;
  }
  if (host === "youtube.com" || host === "m.youtube.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    const id =
      parts.length === 1 && parts[0] === "watch"
        ? url.searchParams.get("v")
        : parts.length === 2 && parts[0] === "live"
          ? parts[1]
          : null;
    return id && youtubeId.test(id)
      ? {
          provider: "youtube",
          sourceIdentifier: id,
          sourceUrl: `https://www.youtube.com/watch?v=${id}`,
        }
      : null;
  }
  return null;
}

function parseTwitchChatUrl(url: ReadonlyURL): ChatSource | null {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "twitch.tv") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const channel = parts.length === 1 ? parts[0]?.toLowerCase() : null;
  return channel && twitchChannel.test(channel) && !twitchReservedPaths.has(channel)
    ? {
        provider: "twitch",
        sourceIdentifier: channel,
        sourceUrl: `https://www.twitch.tv/${channel}`,
      }
    : null;
}

const activeChatSourceParsers = [parseYoutubeChatUrl];

export function parseChatSource(value: string): ChatSource | null {
  const url = parseUrl(value);
  if (!url) return null;

  for (const parser of activeChatSourceParsers) {
    const source = parser(url);
    if (source) return source;
  }
  return null;
}

export function addChatSource(sources: readonly ChatSource[], value: string) {
  if (sources.length >= MAX_CHAT_SOURCES) {
    return erro({ type: "chat source input error", reason: "limit" });
  }
  const source = parseChatSource(value);
  if (!source) return erro({ type: "chat source input error", reason: "unsupported" });
  if (sources.some((current) => chatSourceKey(current) === chatSourceKey(source))) {
    return erro({ type: "chat source input error", reason: "duplicate" });
  }
  return ok([...sources, source]);
}

// Twitch is deliberately absent from activeChatSourceParsers. Its canonicalizer
// remains available so returning the provider is a one-entry registry change.
export function parseTwitchChatSource(value: string): ChatSource | null {
  const url = parseUrl(value);
  return url ? parseTwitchChatUrl(url) : null;
}

export const ChatSourceUrlSchema = z
  .string()
  .trim()
  .refine((value) => parseChatSource(value) !== null, "Unsupported YouTube URL.");

export const ChatSourceListSchema = z
  .array(z.string().trim().min(1).max(500))
  .max(MAX_CHAT_SOURCES)
  .transform((urls, context) => {
    let sources: readonly ChatSource[] = [];
    for (const url of urls) {
      const $sources = addChatSource(sources, url);
      if ($sources.isErr()) {
        context.addIssue({
          code: "custom",
          message:
            $sources.error.reason === "duplicate"
              ? "Duplicate chat source."
              : $sources.error.reason === "limit"
                ? `At most ${MAX_CHAT_SOURCES} chat sources are allowed.`
                : "Unsupported YouTube URL.",
        });
        return z.NEVER;
      }
      sources = $sources.value;
    }
    return sources;
  });
