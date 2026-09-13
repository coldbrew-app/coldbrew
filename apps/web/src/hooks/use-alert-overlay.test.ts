import { AlertOverlayOpenSchema, AlertPlaybackIdSchema } from "@coldbrew/packages/alerts.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AlertOverlayStreamError,
  initialAlertSourceSignals,
  isPermanentAlertHeartbeatError,
  maintainAlertHeartbeat,
  resolveAlertFinishAcknowledgement,
  resolveAlertSourceState,
  retryAlertAcknowledgement,
  settleAlertSourceSignals,
  streamAlertOverlay,
} from "./use-alert-overlay";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("alert overlay acknowledgements", () => {
  it("does not send a second finish after a server-driven skip", () => {
    const playbackId = AlertPlaybackIdSchema.parse("64fb569a-95bb-4d1a-a6ad-765b0f2d5702");

    expect(resolveAlertFinishAcknowledgement([playbackId], playbackId, "interrupted")).toEqual({
      acknowledge: false,
      remaining: [],
    });
  });

  it("acknowledges a normal completed playback", () => {
    const playbackId = AlertPlaybackIdSchema.parse("64fb569a-95bb-4d1a-a6ad-765b0f2d5702");

    expect(resolveAlertFinishAcknowledgement([], playbackId, "completed")).toEqual({
      acknowledge: true,
      remaining: [],
    });
  });

  it("keeps a completed playback local while finish acknowledgement retries", async () => {
    vi.useFakeTimers();
    let currentPlayback: string | null = "64fb569a-95bb-4d1a-a6ad-765b0f2d5702";
    let attempts = 0;
    const controller = new AbortController();
    const completion = retryAlertAcknowledgement(
      () => {
        attempts += 1;
        return attempts < 3 ? Promise.reject(new TypeError("offline")) : Promise.resolve();
      },
      { signal: controller.signal },
    ).then(() => {
      currentPlayback = null;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toBe(1);
    expect(currentPlayback).not.toBeNull();
    await vi.advanceTimersByTimeAsync(250);
    expect(attempts).toBe(2);
    expect(currentPlayback).not.toBeNull();
    await vi.advanceTimersByTimeAsync(500);
    await completion;

    expect(attempts).toBe(3);
    expect(currentPlayback).toBeNull();
  });

  it("aborts the underlying request when an acknowledgement attempt times out", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let attempts = 0;
    let firstSignal: AbortSignal | undefined;
    const completion = retryAlertAcknowledgement(
      (signal) => {
        attempts += 1;
        if (attempts > 1) return Promise.resolve();
        firstSignal = signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
      { signal: controller.signal, timeoutMs: 6_000 },
    );

    await vi.advanceTimersByTimeAsync(5_000);
    expect(firstSignal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(250);
    await completion;

    expect(attempts).toBe(2);
  });

  it("keeps the player identity through a transient heartbeat failure and retries", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let attempts = 0;
    let firstSignal: AbortSignal | undefined;
    const heartbeat = maintainAlertHeartbeat(
      (signal) => {
        attempts += 1;
        if (attempts > 1) return Promise.resolve();
        firstSignal = signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
      { signal: controller.signal },
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(firstSignal?.aborted).toBe(true);
    expect(attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(attempts).toBe(2);

    controller.abort();
    await heartbeat;
  });

  it("invalidates only on an explicit permanent heartbeat rejection", () => {
    expect(isPermanentAlertHeartbeatError(new TypeError("offline"))).toBe(false);
    expect(isPermanentAlertHeartbeatError({ data: { code: "INTERNAL_SERVER_ERROR" } })).toBe(false);
    expect(isPermanentAlertHeartbeatError({ data: { code: "CONFLICT" } })).toBe(true);
    expect(isPermanentAlertHeartbeatError({ data: { code: "NOT_FOUND" } })).toBe(true);
  });

  it("does not settle an OBS source until its readiness handshake completes", () => {
    const initial = initialAlertSourceSignals(true, true);
    expect(resolveAlertSourceState(initial)).toEqual({
      active: null,
      visible: null,
      ready: false,
    });
    expect(resolveAlertSourceState({ ...initial, active: false })).toEqual({
      active: false,
      visible: null,
      ready: false,
    });
    expect(resolveAlertSourceState(settleAlertSourceSignals(initial))).toEqual({
      active: true,
      visible: true,
      ready: true,
    });
    expect(resolveAlertSourceState(initialAlertSourceSignals(false, false))).toEqual({
      active: true,
      visible: true,
      ready: true,
    });
  });

  it("requires both OBS and document visibility before claiming playback", () => {
    const initial = initialAlertSourceSignals(true, true);
    expect(resolveAlertSourceState({ ...initial, active: true })).toEqual({
      active: true,
      visible: null,
      ready: false,
    });

    const ready = settleAlertSourceSignals(initial);

    expect(resolveAlertSourceState({ ...ready, obsVisible: false })).toMatchObject({
      active: false,
      visible: false,
    });
    expect(
      resolveAlertSourceState({ ...ready, active: true, documentVisible: true, obsVisible: false }),
    ).toMatchObject({ active: true, visible: false });
    expect(
      resolveAlertSourceState({ ...ready, active: true, documentVisible: false, obsVisible: true }),
    ).toMatchObject({ active: true, visible: false });
  });

  it("exposes a validated async event stream and keeps the token out of fetch URLs", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{"type":"keepalive"}\n'));
    vi.stubGlobal("fetch", fetchMock);
    const identity = AlertOverlayOpenSchema.parse({
      playerId: "6a9cabbb-d675-40f5-a248-c40558f75d58",
      generation: 2,
      state: "active",
      leaseExpiresAt: "2026-09-13T10:00:00Z",
    });
    const token = "t".repeat(32);
    const events = [];

    for await (const event of streamAlertOverlay(identity, token, new AbortController().signal)) {
      events.push(event);
    }

    expect(events).toEqual([{ type: "keepalive" }]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/alerts/stream");
    expect(fetchMock.mock.calls[0]?.[1]?.body).toContain(token);
  });

  it("turns malformed stream events into the typed browser seam error", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response('{"raw":true}\n')));
    const identity = AlertOverlayOpenSchema.parse({
      playerId: "6a9cabbb-d675-40f5-a248-c40558f75d58",
      generation: 2,
      state: "active",
      leaseExpiresAt: "2026-09-13T10:00:00Z",
    });
    const collect = async () => {
      for await (const _event of streamAlertOverlay(
        identity,
        "t".repeat(32),
        new AbortController().signal,
      )) {
        // Consume the full stream so decoding errors reach the caller.
      }
    };

    const failure = collect();
    await expect(failure).rejects.toBeInstanceOf(AlertOverlayStreamError);
    await expect(failure).rejects.toMatchObject({
      name: "AlertOverlayStreamError",
      type: "invalid event",
    });
  });
});
