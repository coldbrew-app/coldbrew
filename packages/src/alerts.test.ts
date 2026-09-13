import { describe, expect, it } from "vitest";

import {
  AlertDiagnosticCodeSchema,
  AlertOverlayEventSchema,
  AlertPlaybackSchema,
  AlertSettingsSchema,
} from "./alerts.js";

const playback = {
  playbackId: "64fb569a-95bb-4d1a-a6ad-765b0f2d5702",
  donationId: "9007199254740993",
  kind: "incoming",
  state: "pending",
  source: "donationalerts",
  author: "Viewer",
  message: "Coffee!",
  amount: "10.00",
  currency: "USD",
  imageAssetId: null,
  soundAssetId: null,
  ttsAssetId: null,
  displayDurationMs: 5_000,
  soundVolume: 70,
  ttsVolume: 80,
  accentColor: "#ffbd3e",
  createdAt: "2026-09-13T10:00:00Z",
  startedAt: null,
  finishedAt: null,
  detail: null,
};

describe("alert schemas", () => {
  it("accepts bounded user settings", () => {
    expect(
      AlertSettingsSchema.parse({
        enabled: true,
        paused: false,
        enabledSources: ["donationalerts", "streamlabs"],
        displayDurationMs: 6_000,
        soundVolume: 70,
        ttsEnabled: true,
        ttsVoice: "ru",
        ttsVolume: 80,
        accentColor: "#ffbd3e",
        imageAssetId: null,
        soundAssetId: null,
      }),
    ).toMatchObject({ soundVolume: 70, ttsVoice: "ru" });
  });

  it("rejects settings outside media playback bounds", () => {
    expect(() =>
      AlertSettingsSchema.parse({
        enabled: true,
        paused: false,
        enabledSources: [],
        displayDurationMs: 999,
        soundVolume: 101,
        ttsEnabled: true,
        ttsVoice: "ru",
        ttsVolume: -1,
        accentColor: "mango",
        imageAssetId: null,
        soundAssetId: null,
      }),
    ).toThrow();
  });

  it("keeps overlay events discriminated", () => {
    expect(AlertOverlayEventSchema.parse({ type: "control", action: "skip" })).toEqual({
      type: "control",
      action: "skip",
    });
    expect(() => AlertOverlayEventSchema.parse({ type: "control", action: "delete" })).toThrow();
    expect(AlertOverlayEventSchema.parse({ type: "keepalive" })).toEqual({ type: "keepalive" });
  });

  it("parses donation IDs from decimal strings without losing precision", () => {
    expect(AlertPlaybackSchema.parse(playback).donationId).toBe(9_007_199_254_740_993n);
  });

  it("rejects donation IDs that JSON already parsed as imprecise numbers", () => {
    expect(() =>
      AlertPlaybackSchema.parse({ ...playback, donationId: 9_007_199_254_740_992 }),
    ).toThrow();
  });

  it("bounds donor-controlled playback text below the stream record limit", () => {
    expect(() => AlertPlaybackSchema.parse({ ...playback, author: "a".repeat(201) })).toThrow();
    expect(() => AlertPlaybackSchema.parse({ ...playback, message: "m".repeat(2_001) })).toThrow();
  });

  it("counts astral Unicode text with the same code-point limits as Go and PostgreSQL", () => {
    expect(
      AlertPlaybackSchema.parse({
        ...playback,
        author: "😀".repeat(200),
        message: "🚀".repeat(2_000),
      }),
    ).toMatchObject({ author: "😀".repeat(200), message: "🚀".repeat(2_000) });
    expect(() => AlertPlaybackSchema.parse({ ...playback, author: "😀".repeat(201) })).toThrow();
    expect(() => AlertPlaybackSchema.parse({ ...playback, message: "🚀".repeat(2_001) })).toThrow();
  });

  it("keeps operational diagnostic codes on a closed wire contract", () => {
    expect(AlertDiagnosticCodeSchema.parse("player_disconnected")).toBe("player_disconnected");
    expect(() => AlertDiagnosticCodeSchema.parse("raw browser error")).toThrow();
  });
});
