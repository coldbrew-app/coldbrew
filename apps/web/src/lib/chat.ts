import { z } from "zod";

export const ChatProviderSchema = z.enum(["youtube", "twitch"]);
export type ChatProvider = z.infer<typeof ChatProviderSchema>;

export const ChatSourceSchema = z.object({
  provider: ChatProviderSchema,
  sourceIdentifier: z.string().min(1).max(100),
  sourceUrl: z.url(),
});
export type ChatSource = z.infer<typeof ChatSourceSchema>;

export const ChatMessageSchema = z.object({
  id: z.string(),
  provider: ChatProviderSchema,
  sourceIdentifier: z.string(),
  author: z.string(),
  text: z.string(),
  occurredAt: z.date(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ChatSourceStateSchema = z.enum(["connecting", "live", "offline", "error"]);
export type ChatSourceState = z.infer<typeof ChatSourceStateSchema>;

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

export function parseChatSource(value: string): ChatSource | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

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
  if (host === "twitch.tv") {
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
  return null;
}

export const ChatSourceUrlSchema = z
  .string()
  .trim()
  .refine((value) => parseChatSource(value) !== null, "Unsupported YouTube or Twitch URL.");
