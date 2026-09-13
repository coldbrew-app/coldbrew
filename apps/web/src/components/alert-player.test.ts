import { afterEach, describe, expect, it, vi } from "vitest";

import {
  preloadAlertAsset,
  reduceAlertPlayerStage,
  resolveAudioDiagnosticCode,
} from "./alert-player";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("alert player state", () => {
  it("advances through preload, presentation, and exit", () => {
    let stage = reduceAlertPlayerStage("idle", { type: "begin" });
    stage = reduceAlertPlayerStage(stage, { type: "preloaded" });
    stage = reduceAlertPlayerStage(stage, { type: "started" });
    stage = reduceAlertPlayerStage(stage, { type: "entered" });
    stage = reduceAlertPlayerStage(stage, { type: "leave" });
    stage = reduceAlertPlayerStage(stage, { type: "exited" });
    stage = reduceAlertPlayerStage(stage, { type: "finished" });
    expect(stage).toBe("idle");
  });

  it("cannot display or release a playback before both acknowledgements", () => {
    const waitingForStart = reduceAlertPlayerStage("preloading", { type: "preloaded" });
    expect(waitingForStart).toBe("starting");
    expect(reduceAlertPlayerStage(waitingForStart, { type: "entered" })).toBe("starting");

    const waitingForFinish = reduceAlertPlayerStage("exiting", { type: "exited" });
    expect(waitingForFinish).toBe("finishing");
    expect(reduceAlertPlayerStage(waitingForFinish, { type: "entered" })).toBe("finishing");
    expect(reduceAlertPlayerStage(waitingForFinish, { type: "finished" })).toBe("idle");
  });

  it("ignores an out-of-order completion", () => {
    expect(reduceAlertPlayerStage("preloading", { type: "leave" })).toBe("preloading");
  });

  it("falls back when an asset does not finish loading", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(
        (_input, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
              once: true,
            });
          }),
      ),
    );
    const loading = preloadAlertAsset(crypto.randomUUID(), undefined, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(8_000);
    await expect(loading).resolves.toBeNull();
  });

  it("maps renderer failures to safe diagnostic codes", () => {
    expect(resolveAudioDiagnosticCode("sound", "unavailable")).toBe("sound_unavailable");
    expect(resolveAudioDiagnosticCode("tts", "unavailable")).toBe("tts_unavailable");
    expect(resolveAudioDiagnosticCode("sound", "blocked")).toBe("audio_blocked");
    expect(resolveAudioDiagnosticCode("tts", "aborted")).toBeNull();
  });

  it("sends an overlay token in the media POST body instead of its URL", async () => {
    const token = "t".repeat(32);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("media"));
    vi.stubGlobal("fetch", fetchMock);
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:alert-media");

    await expect(
      preloadAlertAsset(crypto.randomUUID(), token, new AbortController().signal),
    ).resolves.toBe("blob:alert-media");

    expect(fetchMock.mock.calls[0]?.[0]).not.toContain(token);
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ token }));
    expect(createObjectURL).toHaveBeenCalledOnce();
  });
});
