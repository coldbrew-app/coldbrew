import type {
  AlertPlayback,
  AlertPlaybackId,
  AlertRendererDiagnosticCode,
} from "@streambrew/packages/alerts.js";
import { useEffect, useReducer, useRef, useState, type Dispatch, type RefObject } from "react";

import type { AlertPlayerAction, AlertPlayerStage } from "./alert-player";

type DiagnosticCallback = (
  playbackId: AlertPlaybackId,
  code: AlertRendererDiagnosticCode,
  signal: AbortSignal,
) => void | Promise<void>;
type FinishedCallback = (
  playbackId: AlertPlaybackId,
  outcome: "completed" | "interrupted",
) => void | Promise<void>;
type StartedCallback = (playbackId: AlertPlaybackId, signal: AbortSignal) => void | Promise<void>;
type CallbackRefs = {
  onDiagnostic: RefObject<DiagnosticCallback | undefined>;
  onFinished: RefObject<FinishedCallback | undefined>;
  onStarted: RefObject<StartedCallback | undefined>;
};
type LoadedAssets = {
  imageUrl: string | null;
  objectUrls: readonly string[];
  soundUrl: string | null;
  ttsUrl: string | null;
};

export function reduceAlertPlayerStage(
  stage: AlertPlayerStage,
  action: AlertPlayerAction,
): AlertPlayerStage {
  switch (action.type) {
    case "begin":
      return "preloading";
    case "preloaded":
      return stage === "preloading" ? "starting" : stage;
    case "started":
      return stage === "starting" ? "entering" : stage;
    case "entered":
      return stage === "entering" ? "shown" : stage;
    case "leave":
      return stage === "entering" || stage === "shown" ? "exiting" : stage;
    case "exited":
      return stage === "exiting" ? "finishing" : stage;
    case "finished":
      return stage === "finishing" ? "idle" : stage;
    case "reset":
      return "idle";
  }
}

async function delay(milliseconds: number, signal: AbortSignal) {
  let cancel: (() => void) | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(signal.reason);
      const timeout = globalThis.setTimeout(resolve, milliseconds);
      cancel = () => {
        globalThis.clearTimeout(timeout);
        reject(signal.reason);
      };
      signal.addEventListener("abort", cancel, { once: true });
    });
  } finally {
    if (cancel) signal.removeEventListener("abort", cancel);
  }
}

export async function preloadAlertAsset(
  assetId: string,
  token: string | undefined,
  parentSignal: AbortSignal,
) {
  const abort = new AbortController();
  const cancel = () => abort.abort(parentSignal.reason);
  if (parentSignal.aborted) cancel();
  parentSignal.addEventListener("abort", cancel, { once: true });
  const timeout = globalThis.setTimeout(
    () => abort.abort(new DOMException("Media timed out")),
    8_000,
  );
  try {
    const response = await fetch(`/api/alerts/media/${assetId}`, {
      ...(token === undefined
        ? { credentials: "same-origin" as const }
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
          }),
      signal: abort.signal,
    });
    if (!response.ok) return null;
    return URL.createObjectURL(await response.blob());
  } catch {
    return null;
  } finally {
    globalThis.clearTimeout(timeout);
    parentSignal.removeEventListener("abort", cancel);
  }
}

async function decodeImage(url: string, signal: AbortSignal) {
  const image = new Image();
  image.src = url;
  if (signal.aborted) {
    image.src = "";
    return;
  }
  const cancel = () => (image.src = "");
  signal.addEventListener("abort", cancel, { once: true });
  try {
    await image.decode();
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

type AudioPlaybackResult = "completed" | "unavailable" | "blocked" | "aborted";

export function resolveAudioDiagnosticCode(
  kind: "sound" | "tts",
  result: AudioPlaybackResult,
): AlertRendererDiagnosticCode | null {
  if (result === "blocked") return "audio_blocked";
  if (result === "unavailable") {
    return kind === "sound" ? "sound_unavailable" : "tts_unavailable";
  }
  return null;
}

function audioFailure(cause: unknown): AudioPlaybackResult {
  return cause instanceof Error && cause.name === "NotAllowedError" ? "blocked" : "unavailable";
}

function playAudio(url: string, volume: number, signal: AbortSignal) {
  return new Promise<AudioPlaybackResult>((resolve) => {
    let audio: HTMLAudioElement;
    try {
      audio = new Audio(url);
    } catch {
      resolve("unavailable");
      return;
    }
    audio.preload = "auto";
    audio.volume = Math.max(0, Math.min(1, volume / 100));
    let finished = false;
    let timeout: ReturnType<typeof globalThis.setTimeout>;
    let ended: () => void;
    let unavailable: () => void;
    let aborted: () => void;
    const finish = (result: AudioPlaybackResult) => {
      if (finished) return;
      finished = true;
      globalThis.clearTimeout(timeout);
      audio.pause();
      audio.removeEventListener("ended", ended);
      audio.removeEventListener("error", unavailable);
      signal.removeEventListener("abort", aborted);
      resolve(result);
    };
    ended = () => finish("completed");
    unavailable = () => finish("unavailable");
    aborted = () => finish("aborted");
    timeout = globalThis.setTimeout(unavailable, 35_000);
    if (signal.aborted) return aborted();
    audio.addEventListener("ended", ended, { once: true });
    audio.addEventListener("error", unavailable, { once: true });
    signal.addEventListener("abort", aborted, { once: true });
    try {
      void audio.play().catch((cause: unknown) => finish(audioFailure(cause)));
    } catch (cause) {
      finish(audioFailure(cause));
    }
  });
}

function loadOptionalAsset(assetId: string | null, token: string | undefined, signal: AbortSignal) {
  return assetId ? preloadAlertAsset(assetId, token, signal) : Promise.resolve(null);
}

async function loadAssets(playback: AlertPlayback, token: string | undefined, signal: AbortSignal) {
  const [imageUrl, soundUrl, ttsUrl] = await Promise.all([
    loadOptionalAsset(playback.imageAssetId, token, signal),
    loadOptionalAsset(playback.soundAssetId, token, signal),
    loadOptionalAsset(playback.ttsAssetId, token, signal),
  ]);
  return {
    imageUrl,
    objectUrls: [imageUrl, soundUrl, ttsUrl].filter((url): url is string => url !== null),
    soundUrl,
    ttsUrl,
  } satisfies LoadedAssets;
}

function createDiagnosticReporter(
  playbackId: AlertPlaybackId,
  signal: AbortSignal,
  callback: RefObject<DiagnosticCallback | undefined>,
) {
  let acknowledgements: readonly Promise<void>[] = [];
  return {
    report: (code: AlertRendererDiagnosticCode) => {
      if (signal.aborted) return;
      try {
        const acknowledgement = callback.current?.(playbackId, code, signal);
        if (acknowledgement !== undefined) {
          acknowledgements = [...acknowledgements, Promise.resolve(acknowledgement)];
        }
      } catch {
        // Renderer diagnostics must never prevent the alert fallback path.
      }
    },
    wait: () => Promise.allSettled(acknowledgements),
  };
}

function reportMissingAssets(
  playback: AlertPlayback,
  assets: LoadedAssets,
  report: (code: AlertRendererDiagnosticCode) => void,
) {
  if (playback.imageAssetId && assets.imageUrl === null) report("image_unavailable");
  if (playback.soundAssetId && assets.soundUrl === null) report("sound_unavailable");
  if (playback.ttsAssetId && assets.ttsUrl === null) report("tts_unavailable");
}

async function resolveImageUrl(
  imageUrl: string | null,
  signal: AbortSignal,
  report: (code: AlertRendererDiagnosticCode) => void,
) {
  if (imageUrl === null) return null;
  const decoded = await Promise.race([
    decodeImage(imageUrl, signal).then(
      () => true,
      () => false,
    ),
    delay(3_000, signal).then(() => false),
  ]).catch(() => false);
  if (decoded || signal.aborted) return imageUrl;
  report("image_unavailable");
  return null;
}

async function playAudioChannel(
  kind: "sound" | "tts",
  url: string,
  volume: number,
  signal: AbortSignal,
  report: (code: AlertRendererDiagnosticCode) => void,
) {
  const code = resolveAudioDiagnosticCode(kind, await playAudio(url, volume, signal));
  if (code) report(code);
}

async function presentPlayback(
  playback: AlertPlayback,
  assets: LoadedAssets,
  signal: AbortSignal,
  dispatch: Dispatch<AlertPlayerAction>,
  report: (code: AlertRendererDiagnosticCode) => void,
) {
  const shownAt = performance.now();
  await delay(360, signal);
  dispatch({ type: "entered" });
  if (assets.soundUrl) {
    await playAudioChannel("sound", assets.soundUrl, playback.soundVolume, signal, report);
  }
  if (assets.ttsUrl && !signal.aborted) {
    await playAudioChannel("tts", assets.ttsUrl, playback.ttsVolume, signal, report);
  }
  if (signal.aborted) return;
  await delay(Math.max(0, playback.displayDurationMs - (performance.now() - shownAt)), signal);
  dispatch({ type: "leave" });
  await delay(300, signal);
  dispatch({ type: "exited" });
}

async function runPlayback({
  callbacks,
  dispatch,
  markCompleted,
  markStarted,
  onAssetsLoaded,
  playback,
  setImageSrc,
  signal,
  token,
}: {
  callbacks: CallbackRefs;
  dispatch: Dispatch<AlertPlayerAction>;
  markCompleted: () => void;
  markStarted: () => void;
  onAssetsLoaded: (urls: readonly string[]) => void;
  playback: AlertPlayback;
  setImageSrc: (url: string | null) => void;
  signal: AbortSignal;
  token: string | undefined;
}) {
  const assets = await loadAssets(playback, token, signal);
  onAssetsLoaded(assets.objectUrls);
  const diagnostics = createDiagnosticReporter(playback.playbackId, signal, callbacks.onDiagnostic);
  reportMissingAssets(playback, assets, diagnostics.report);
  const imageUrl = await resolveImageUrl(assets.imageUrl, signal, diagnostics.report);
  if (signal.aborted) return;
  dispatch({ type: "preloaded" });
  await callbacks.onStarted.current?.(playback.playbackId, signal);
  markStarted();
  if (signal.aborted) return;
  setImageSrc(imageUrl);
  dispatch({ type: "started" });
  await presentPlayback(playback, assets, signal, dispatch, diagnostics.report);
  await diagnostics.wait();
  if (signal.aborted) return;
  markCompleted();
  await callbacks.onFinished.current?.(playback.playbackId, "completed");
  dispatch({ type: "finished" });
}

function startPlayback(
  active: boolean,
  playback: AlertPlayback | null,
  token: string | undefined,
  callbacks: CallbackRefs,
  dispatch: Dispatch<AlertPlayerAction>,
  setImageSrc: (url: string | null) => void,
) {
  if (playback === null || !active) {
    dispatch({ type: "reset" });
    setImageSrc(null);
    return;
  }
  const abort = new AbortController();
  let objectUrls: readonly string[] = [];
  let started = false;
  let completed = false;
  dispatch({ type: "begin" });
  setImageSrc(null);
  void runPlayback({
    callbacks,
    dispatch,
    markCompleted: () => (completed = true),
    markStarted: () => (started = true),
    onAssetsLoaded: (urls) => (objectUrls = urls),
    playback,
    setImageSrc,
    signal: abort.signal,
    token,
  })
    .catch(() => undefined)
    .finally(async () => {
      if (abort.signal.aborted && started && !completed) {
        await callbacks.onFinished.current?.(playback.playbackId, "interrupted");
      }
      for (const url of objectUrls) URL.revokeObjectURL(url);
    })
    .catch(() => undefined);
  return () => abort.abort(new DOMException("Alert interrupted", "AbortError"));
}

export function useAlertPlayerPresentation({
  active,
  interruptionKey,
  onDiagnostic,
  onFinished,
  onStarted,
  playback,
  token,
}: {
  active: boolean;
  interruptionKey: number;
  onDiagnostic: DiagnosticCallback | undefined;
  onFinished: FinishedCallback | undefined;
  onStarted: StartedCallback | undefined;
  playback: AlertPlayback | null;
  token: string | undefined;
}) {
  const [stage, dispatch] = useReducer(reduceAlertPlayerStage, "idle");
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const onDiagnosticRef = useRef(onDiagnostic);
  const onFinishedRef = useRef(onFinished);
  const onStartedRef = useRef(onStarted);
  useEffect(() => {
    onDiagnosticRef.current = onDiagnostic;
    onFinishedRef.current = onFinished;
    onStartedRef.current = onStarted;
  }, [onDiagnostic, onFinished, onStarted]);
  useEffect(
    () =>
      startPlayback(
        active,
        playback,
        token,
        { onDiagnostic: onDiagnosticRef, onFinished: onFinishedRef, onStarted: onStartedRef },
        dispatch,
        setImageSrc,
      ),
    [active, interruptionKey, playback, token],
  );
  const visibleStage: "entering" | "exiting" | "hidden" | "shown" =
    stage === "entering"
      ? "entering"
      : stage === "exiting"
        ? "exiting"
        : stage === "shown"
          ? "shown"
          : "hidden";
  return { imageSrc, visibleStage };
}
