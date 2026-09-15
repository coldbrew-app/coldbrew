import { z } from "zod";

import {
  DonationAmountSchema,
  DonationAssetSchema,
  DonationIdSchema,
  DonationSourceSchema,
} from "./schemas.js";

export const AlertAssetIdSchema = z.uuid().brand("alert asset id");
export type AlertAssetId = z.infer<typeof AlertAssetIdSchema>;

export const AlertAssetKindSchema = z.enum(["image", "sound", "tts"]);
export type AlertAssetKind = z.infer<typeof AlertAssetKindSchema>;

export const AlertAssetSchema = z.object({
  assetId: AlertAssetIdSchema,
  kind: AlertAssetKindSchema,
  contentType: z.string().min(1).max(100),
  sizeBytes: z.int().nonnegative(),
  durationMs: z.int().positive().nullable(),
  createdAt: z.coerce.date(),
});
export type AlertAsset = z.infer<typeof AlertAssetSchema>;

export const AlertSettingsSchema = z.object({
  enabled: z.boolean(),
  paused: z.boolean(),
  enabledSources: z.array(DonationSourceSchema).max(DonationSourceSchema.options.length),
  displayDurationMs: z.int().min(1_000).max(30_000),
  soundVolume: z.int().min(0).max(100),
  ttsEnabled: z.boolean(),
  ttsVoice: z.string().trim().min(1).max(64),
  ttsVolume: z.int().min(0).max(100),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  imageAssetId: AlertAssetIdSchema.nullable(),
  soundAssetId: AlertAssetIdSchema.nullable(),
});
export type AlertSettings = z.infer<typeof AlertSettingsSchema>;

export const AlertPlaybackIdSchema = z.uuid().brand("alert playback id");
export type AlertPlaybackId = z.infer<typeof AlertPlaybackIdSchema>;

export const AlertPlaybackKindSchema = z.enum(["incoming", "replay", "test"]);
export type AlertPlaybackKind = z.infer<typeof AlertPlaybackKindSchema>;

export const AlertDonationIdSchema = z
  .union([z.string().regex(/^[1-9]\d*$/), z.bigint().positive()])
  .transform((value) => DonationIdSchema.parse(value));

export const AlertOverlayTokenSchema = z.string().min(32).max(100);

export const AlertRendererDiagnosticCodeSchema = z.enum([
  "image_unavailable",
  "sound_unavailable",
  "tts_unavailable",
  "audio_blocked",
]);
export type AlertRendererDiagnosticCode = z.infer<typeof AlertRendererDiagnosticCodeSchema>;

export const AlertDiagnosticCodeSchema = z.enum([
  ...AlertRendererDiagnosticCodeSchema.options,
  "alert_expired",
  "backlog_limit",
  "playback_timeout",
  "player_disconnected",
  "overlay_rotated",
  "playback_issue",
]);
export type AlertDiagnosticCode = z.infer<typeof AlertDiagnosticCodeSchema>;

export const AlertPlaybackStateSchema = z.enum([
  "preparing",
  "pending",
  "playing",
  "completed",
  "skipped",
  "expired",
  "interrupted",
]);
export type AlertPlaybackState = z.infer<typeof AlertPlaybackStateSchema>;

function stringWithMaximumCodePoints(maximum: number) {
  return z.string().refine((value) => Array.from(value).length <= maximum, {
    message: `Must contain at most ${maximum} Unicode code points`,
  });
}

export const AlertPlaybackSchema = z.object({
  playbackId: AlertPlaybackIdSchema,
  donationId: AlertDonationIdSchema.nullable(),
  kind: AlertPlaybackKindSchema,
  source: DonationSourceSchema.nullable(),
  author: stringWithMaximumCodePoints(200).nullable(),
  message: stringWithMaximumCodePoints(2_000).nullable(),
  amount: DonationAmountSchema,
  currency: DonationAssetSchema,
  imageAssetId: AlertAssetIdSchema.nullable(),
  soundAssetId: AlertAssetIdSchema.nullable(),
  ttsAssetId: AlertAssetIdSchema.nullable(),
  displayDurationMs: z.int().min(1_000).max(30_000),
  soundVolume: z.int().min(0).max(100),
  ttsVolume: z.int().min(0).max(100),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  state: AlertPlaybackStateSchema,
  createdAt: z.coerce.date(),
  startedAt: z.coerce.date().nullable(),
  finishedAt: z.coerce.date().nullable(),
  detail: z.string().max(1_000).nullable(),
});
export type AlertPlayback = z.infer<typeof AlertPlaybackSchema>;

export const AlertPlayerSchema = z.object({
  playerId: z.uuid(),
  generation: z.int().positive(),
  state: z.enum(["active", "standby"]),
  active: z.boolean(),
  visible: z.boolean(),
  lastHeartbeatAt: z.coerce.date(),
  leaseExpiresAt: z.coerce.date(),
  currentPlaybackId: AlertPlaybackIdSchema.nullable(),
});
export type AlertPlayer = z.infer<typeof AlertPlayerSchema>;

export const AlertDiagnosticSchema = z.object({
  code: AlertDiagnosticCodeSchema,
  level: z.enum(["info", "warning", "error"]),
  detail: z.string().min(1).max(1_000),
  occurredAt: z.coerce.date(),
});
export type AlertDiagnostic = z.infer<typeof AlertDiagnosticSchema>;

export const AlertDashboardSchema = z.object({
  settings: AlertSettingsSchema,
  connectedSources: z.array(DonationSourceSchema).max(DonationSourceSchema.options.length),
  hasOverlayToken: z.boolean(),
  imageAsset: AlertAssetSchema.nullable(),
  soundAsset: AlertAssetSchema.nullable(),
  activePlayer: AlertPlayerSchema.nullable(),
  pendingCount: z.int().nonnegative(),
  currentPlayback: AlertPlaybackSchema.nullable(),
  recentPlaybacks: z.array(AlertPlaybackSchema),
  diagnostics: z.array(AlertDiagnosticSchema),
});
export type AlertDashboard = z.infer<typeof AlertDashboardSchema>;

export const AlertOverlayOpenSchema = z.object({
  playerId: z.uuid(),
  generation: z.int().positive(),
  state: z.enum(["active", "standby"]),
  leaseExpiresAt: z.coerce.date(),
});
export type AlertOverlayOpen = z.infer<typeof AlertOverlayOpenSchema>;

export const AlertOverlayEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("playback"),
    playback: AlertPlaybackSchema,
  }),
  z.object({
    type: z.literal("control"),
    action: z.enum(["skip", "pause", "resume"]),
  }),
  z.object({
    type: z.literal("revoked"),
  }),
  z.object({
    type: z.literal("keepalive"),
  }),
]);
export type AlertOverlayEvent = z.infer<typeof AlertOverlayEventSchema>;
