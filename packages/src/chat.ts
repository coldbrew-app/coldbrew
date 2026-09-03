import { z } from "zod";

export const ChatProviderSchema = z.enum(["youtube", "twitch", "kick", "boosty", "vk_video"]);
export type ChatProvider = z.infer<typeof ChatProviderSchema>;

export const ChatCapabilitySchema = z.enum([
  "read",
  "send_message",
  "delete_message",
  "timeout_user",
  "ban_user",
  "unban_user",
]);
export type ChatCapability = z.infer<typeof ChatCapabilitySchema>;

export const ChatProviderConnectionIdSchema = z.uuid();
export type ChatProviderConnectionId = z.infer<typeof ChatProviderConnectionIdSchema>;

export const ChatSourceIdSchema = z.uuid();
export type ChatSourceId = z.infer<typeof ChatSourceIdSchema>;

export const ChatProviderConnectionStatusSchema = z.enum([
  "connected",
  "refresh_required",
  "error",
]);
export type ChatProviderConnectionStatus = z.infer<typeof ChatProviderConnectionStatusSchema>;

export const ChatProviderConnectionSchema = z.object({
  connectionId: ChatProviderConnectionIdSchema,
  provider: ChatProviderSchema,
  providerUserId: z.string().min(1).max(200),
  displayName: z.string().min(1).max(200),
  status: ChatProviderConnectionStatusSchema,
  capabilities: z.array(ChatCapabilitySchema),
  connectedAt: z.coerce.date(),
});
export type ChatProviderConnection = z.infer<typeof ChatProviderConnectionSchema>;

export const ChatSourceSchema = z.object({
  sourceId: ChatSourceIdSchema,
  connectionId: ChatProviderConnectionIdSchema,
  provider: ChatProviderSchema,
  providerSourceId: z.string().min(1).max(200),
  displayName: z.string().min(1).max(200),
  sourceUrl: z.url(),
  position: z.int().nonnegative(),
  enabled: z.boolean(),
});
export type ChatSource = z.infer<typeof ChatSourceSchema>;

export const ChatAuthorSchema = z.object({
  id: z.string().min(1).max(200),
  displayName: z.string().min(1).max(200),
});
export type ChatAuthor = z.infer<typeof ChatAuthorSchema>;

export const ChatMessageSchema = z.object({
  id: z.string().min(1).max(300),
  sourceId: ChatSourceIdSchema,
  connectionId: ChatProviderConnectionIdSchema,
  provider: ChatProviderSchema,
  author: ChatAuthorSchema,
  text: z.string(),
  occurredAt: z.coerce.date(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export function chatSourceKey(source: Pick<ChatSource, "sourceId">) {
  return source.sourceId;
}

export function chatMessageKey(message: Pick<ChatMessage, "sourceId" | "id">) {
  return `${message.sourceId}:${message.id}`;
}

export const ChatSourceStateSchema = z.enum(["connecting", "live", "offline", "error"]);
export type ChatSourceState = z.infer<typeof ChatSourceStateSchema>;

export const ChatConnectionErrorCodeSchema = z.enum([
  "configuration_unavailable",
  "overlay_not_found",
  "stream_unavailable",
  "transport_unavailable",
  "unauthorized",
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
    type: z.literal("message_deleted"),
    sourceId: ChatSourceIdSchema,
    messageId: z.string().min(1).max(300),
  }),
  z.object({
    type: z.literal("state"),
    sourceId: ChatSourceIdSchema,
    state: ChatSourceStateSchema,
    detail: z.string().optional(),
  }),
  z.object({
    type: z.literal("connection_error"),
    error: ChatConnectionErrorSchema,
  }),
]);
export type ChatStreamEvent = z.infer<typeof ChatStreamEventSchema>;

export const ChatModerationCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("delete_message"),
    sourceId: ChatSourceIdSchema,
    messageId: z.string().min(1).max(300),
  }),
  z.object({
    type: z.literal("timeout_user"),
    sourceId: ChatSourceIdSchema,
    providerUserId: z.string().min(1).max(200),
    durationSeconds: z.int().positive().max(1_209_600),
    reason: z.string().trim().max(500).optional(),
  }),
  z.object({
    type: z.literal("ban_user"),
    sourceId: ChatSourceIdSchema,
    providerUserId: z.string().min(1).max(200),
    reason: z.string().trim().max(500).optional(),
  }),
  z.object({
    type: z.literal("unban_user"),
    sourceId: ChatSourceIdSchema,
    providerUserId: z.string().min(1).max(200),
  }),
]);
export type ChatModerationCommand = z.infer<typeof ChatModerationCommandSchema>;

export const ChatCommandResultSchema = z.object({
  sourceId: ChatSourceIdSchema,
  status: z.enum(["succeeded", "failed", "unsupported"]),
  detail: z.string().optional(),
});
export type ChatCommandResult = z.infer<typeof ChatCommandResultSchema>;

export const ChatBroadcastResultSchema = z.object({
  results: z.array(ChatCommandResultSchema),
});
export type ChatBroadcastResult = z.infer<typeof ChatBroadcastResultSchema>;

export const ChatConfigSchema = z.object({
  connections: z.array(ChatProviderConnectionSchema),
  sources: z.array(ChatSourceSchema),
  hasOverlayToken: z.boolean(),
});
export type ChatConfig = z.infer<typeof ChatConfigSchema>;

export const ChatProviderAvailabilitySchema = z.object({
  provider: ChatProviderSchema,
  access: z.enum(["full", "read_only", "unavailable"]),
  detail: z.string().optional(),
});
export type ChatProviderAvailability = z.infer<typeof ChatProviderAvailabilitySchema>;

export const MAX_CHAT_MESSAGE_LENGTH = 500;
