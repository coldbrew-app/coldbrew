import { z } from "zod";

export const MAX_RESTREAM_DESTINATIONS = 3;

export const RestreamDestinationIdSchema = z.uuid().brand("restream destination id");
export type RestreamDestinationId = z.infer<typeof RestreamDestinationIdSchema>;

export const RestreamSessionIdSchema = z.uuid().brand("restream session id");
export type RestreamSessionId = z.infer<typeof RestreamSessionIdSchema>;

export const RestreamPlatformSchema = z.enum(["twitch", "youtube", "kick", "custom"]);
export type RestreamPlatform = z.infer<typeof RestreamPlatformSchema>;

export const RestreamDestinationStateSchema = z.enum(["idle", "forwarding", "error"]);
export type RestreamDestinationState = z.infer<typeof RestreamDestinationStateSchema>;

export const RestreamIngestKeySchema = z
  .string()
  .regex(/^sb_[A-Za-z0-9_-]{43}$/)
  .brand("restream ingest key");
export type RestreamIngestKey = z.infer<typeof RestreamIngestKeySchema>;

export const RestreamServerUrlSchema = z
  .string()
  .min(10)
  .max(2048)
  .regex(/^rtmps?:\/\/[^\s#]+$/);
export type RestreamServerUrl = z.infer<typeof RestreamServerUrlSchema>;

export const RestreamStreamKeySchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[^\s#]+$/);

export const RestreamDestinationSchema = z.object({
  destinationId: RestreamDestinationIdSchema,
  platform: RestreamPlatformSchema,
  label: z.string().trim().min(1).max(64),
  serverUrl: RestreamServerUrlSchema,
  streamKeyHint: z.string().min(1).max(8),
  enabled: z.boolean(),
  position: z
    .int()
    .nonnegative()
    .max(MAX_RESTREAM_DESTINATIONS - 1),
});
export type RestreamDestination = z.infer<typeof RestreamDestinationSchema>;

export const RestreamDestinationSessionStateSchema = z.object({
  destinationId: RestreamDestinationIdSchema,
  state: RestreamDestinationStateSchema,
  outboundBytes: z.int().nonnegative(),
});

export const RestreamSessionSchema = z.object({
  sessionId: RestreamSessionIdSchema,
  status: z.enum(["connecting", "live"]),
  startedAt: z.coerce.date(),
  liveAt: z.coerce.date().nullable(),
  lastHeartbeatAt: z.coerce.date(),
  destinations: z.array(RestreamDestinationSessionStateSchema),
});
export type RestreamSession = z.infer<typeof RestreamSessionSchema>;

export const RestreamConfigSchema = z.object({
  ingest: z
    .object({
      serverUrl: z.string().regex(/^rtmp:\/\/[^\s]+$/),
      streamKey: RestreamIngestKeySchema,
    })
    .nullable(),
  destinations: z.array(RestreamDestinationSchema).max(MAX_RESTREAM_DESTINATIONS),
  session: RestreamSessionSchema.nullable(),
  plan: z.object({
    status: z.literal("beta"),
    monthlyPriceUsdCents: z.literal(1999),
    maxDestinations: z.literal(MAX_RESTREAM_DESTINATIONS),
  }),
});
export type RestreamConfig = z.infer<typeof RestreamConfigSchema>;

const RestreamMediaNodeIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const RestreamMediaPublisherIdSchema = z.string().min(1).max(128);

export const RestreamMediaAuthorizeRequestSchema = z.object({
  type: z.literal("authorize"),
  nodeId: RestreamMediaNodeIdSchema,
  publisherId: RestreamMediaPublisherIdSchema,
  path: RestreamIngestKeySchema,
});

export const RestreamMediaHeartbeatRequestSchema = z.object({
  type: z.literal("heartbeat"),
  nodeId: RestreamMediaNodeIdSchema,
  sessionId: RestreamSessionIdSchema,
  destinations: z.array(RestreamDestinationSessionStateSchema).max(MAX_RESTREAM_DESTINATIONS),
});

export const RestreamMediaEndedRequestSchema = z.object({
  type: z.literal("ended"),
  nodeId: RestreamMediaNodeIdSchema,
  sessionId: RestreamSessionIdSchema,
});

export const RestreamMediaRequestSchema = z.discriminatedUnion("type", [
  RestreamMediaAuthorizeRequestSchema,
  RestreamMediaHeartbeatRequestSchema,
  RestreamMediaEndedRequestSchema,
]);
export type RestreamMediaRequest = z.infer<typeof RestreamMediaRequestSchema>;

export const RestreamMediaAuthorizeResponseSchema = z.object({
  sessionId: RestreamSessionIdSchema,
  destinations: z
    .array(
      z.object({
        destinationId: RestreamDestinationIdSchema,
        targetUrl: z
          .string()
          .min(12)
          .max(3072)
          .regex(/^rtmps?:\/\/[^\s]+#[^\s#]+$/),
      }),
    )
    .min(1)
    .max(MAX_RESTREAM_DESTINATIONS),
});
export type RestreamMediaAuthorizeResponse = z.infer<typeof RestreamMediaAuthorizeResponseSchema>;
