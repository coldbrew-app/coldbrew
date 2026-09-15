import type {
  AlertPlayback,
  AlertPlaybackId,
  AlertRendererDiagnosticCode,
} from "@streambrew/packages/alerts.js";
import { cn } from "@web/lib/utils";

import { AlertCard } from "./alert-card";
import { useAlertPlayerPresentation } from "./alert-player-runtime";

export type AlertPlayerStage =
  | "idle"
  | "preloading"
  | "starting"
  | "entering"
  | "shown"
  | "exiting"
  | "finishing";
export type AlertPlayerAction =
  | { type: "begin" }
  | { type: "preloaded" }
  | { type: "started" }
  | { type: "entered" }
  | { type: "leave" }
  | { type: "exited" }
  | { type: "finished" }
  | { type: "reset" };

export {
  preloadAlertAsset,
  reduceAlertPlayerStage,
  resolveAudioDiagnosticCode,
} from "./alert-player-runtime";

export function AlertPlayer({
  active = true,
  className,
  interruptionKey = 0,
  onDiagnostic,
  onFinished,
  onStarted,
  playback,
  token,
}: {
  active?: boolean;
  className?: string;
  interruptionKey?: number;
  onDiagnostic?: (
    playbackId: AlertPlaybackId,
    code: AlertRendererDiagnosticCode,
    signal: AbortSignal,
  ) => void | Promise<void>;
  onFinished?: (
    playbackId: AlertPlaybackId,
    outcome: "completed" | "interrupted",
  ) => void | Promise<void>;
  onStarted?: (playbackId: AlertPlaybackId, signal: AbortSignal) => void | Promise<void>;
  playback: AlertPlayback | null;
  token?: string;
}) {
  const { imageSrc, visibleStage } = useAlertPlayerPresentation({
    active,
    interruptionKey,
    onDiagnostic,
    onFinished,
    onStarted,
    playback,
    token,
  });

  return (
    <div
      aria-live="polite"
      className={cn(
        "relative flex size-full items-end justify-center overflow-hidden p-[4%]",
        className,
      )}
    >
      {playback && <AlertCard imageSrc={imageSrc} playback={playback} stage={visibleStage} />}
    </div>
  );
}
