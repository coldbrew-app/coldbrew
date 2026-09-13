import {
  AlertOverlayEventSchema,
  type AlertOverlayEvent,
  type AlertOverlayOpen,
  type AlertPlayback,
  type AlertPlaybackId,
  type AlertRendererDiagnosticCode,
} from "@coldbrew/packages/alerts.js";
import { parseJson, RequestError } from "@coldbrew/packages/http.js";
import { readNdjsonLines } from "@web/lib/ndjson";
import { type Api, useApi } from "@web/lib/trpc";
import { useCallback, useEffect, useRef, useState } from "react";

type ObsSourceEvent = CustomEvent<{ active?: boolean; visible?: boolean }>;

export type AlertSourceState = {
  active: boolean | null;
  visible: boolean | null;
  ready: boolean;
};

export type AlertSourceSignals = {
  active: boolean | null;
  documentVisible: boolean;
  obsPresent: boolean;
  obsVisible: boolean | null;
  settled: boolean;
};

const maximumStreamLineLength = 64 * 1024;
const acknowledgementAttemptTimeoutMs = 5_000;
const heartbeatIntervalMs = 5_000;
const heartbeatFailureRetryMs = 1_000;
const startAcknowledgementTimeoutMs = 15_000;
const diagnosticAcknowledgementTimeoutMs = 15_000;
const finishAcknowledgementTimeoutMs = 110_000;
const obsReadinessSettleMs = 1_000;

export class AlertOverlayStreamError extends Error {
  readonly status?: number;
  readonly type:
    | "fetch error"
    | "http error"
    | "missing body"
    | "read error"
    | "invalid event"
    | "event too large";

  constructor(
    type: AlertOverlayStreamError["type"],
    options: ErrorOptions & { status?: number } = {},
  ) {
    super("The donation alert stream failed.", options);
    this.name = "AlertOverlayStreamError";
    this.type = type;
    this.status = options.status;
  }
}

class AlertAcknowledgementTimeoutError extends Error {
  constructor(options: ErrorOptions = {}) {
    super("The donation alert acknowledgement timed out.", options);
    this.name = "AlertAcknowledgementTimeoutError";
  }
}

function abortError() {
  return new DOMException("Donation alert operation cancelled.", "AbortError");
}

function delay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    let timeout: ReturnType<typeof globalThis.setTimeout>;
    const cancel = () => {
      globalThis.clearTimeout(timeout);
      reject(abortError());
    };
    timeout = globalThis.setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", cancel, { once: true });
  });
}

async function attemptAcknowledgement<Result>(
  acknowledge: (signal: AbortSignal) => Promise<Result>,
  timeoutMs: number,
  signal: AbortSignal,
) {
  if (signal.aborted) throw abortError();

  const attempt = new AbortController();
  const timeoutError = new AlertAcknowledgementTimeoutError();
  let timedOut = false;
  const timer = globalThis.setTimeout(() => {
    timedOut = true;
    attempt.abort(timeoutError);
  }, timeoutMs);
  const relayAbort = () => attempt.abort(signal.reason);
  signal.addEventListener("abort", relayAbort, { once: true });
  const aborted = new Promise<never>((_resolve, reject) => {
    const fail = () => reject(timedOut ? timeoutError : abortError());
    attempt.signal.addEventListener("abort", fail, { once: true });
  });
  try {
    return await Promise.race([acknowledge(attempt.signal), aborted]);
  } finally {
    globalThis.clearTimeout(timer);
    attempt.abort();
    signal.removeEventListener("abort", relayAbort);
  }
}

function assertAcknowledgementActive(signal: AbortSignal, shouldContinue: () => boolean) {
  if (signal.aborted || !shouldContinue()) throw abortError();
}

function requireRemainingTime<Remaining extends number | undefined>(
  remaining: Remaining,
  lastCause: unknown,
): Remaining {
  if (remaining !== undefined && remaining <= 0) {
    throw new AlertAcknowledgementTimeoutError({ cause: lastCause });
  }
  return remaining;
}

export async function retryAlertAcknowledgement<Result>(
  acknowledge: (signal: AbortSignal) => Promise<Result>,
  {
    signal,
    shouldContinue = () => true,
    timeoutMs,
  }: {
    signal: AbortSignal;
    shouldContinue?: () => boolean;
    timeoutMs?: number;
  },
) {
  const deadline = timeoutMs === undefined ? undefined : Date.now() + timeoutMs;
  let retryDelayMs = 250;
  let lastCause: unknown;

  while (true) {
    assertAcknowledgementActive(signal, shouldContinue);
    const remaining = requireRemainingTime(
      deadline === undefined ? undefined : deadline - Date.now(),
      lastCause,
    );

    try {
      await attemptAcknowledgement(
        acknowledge,
        Math.min(acknowledgementAttemptTimeoutMs, remaining ?? Number.POSITIVE_INFINITY),
        signal,
      );
      return;
    } catch (cause) {
      assertAcknowledgementActive(signal, shouldContinue);
      lastCause = cause;
    }

    const delayRemaining = requireRemainingTime(
      deadline === undefined ? retryDelayMs : deadline - Date.now(),
      lastCause,
    );
    await delay(Math.min(retryDelayMs, delayRemaining), signal);
    retryDelayMs = Math.min(retryDelayMs * 2, 5_000);
  }
}

function trpcErrorCode(error: unknown) {
  if (typeof error !== "object" || error === null || !("data" in error)) return undefined;
  const { data } = error;
  if (typeof data !== "object" || data === null || !("code" in data)) return undefined;
  return typeof data.code === "string" ? data.code : undefined;
}

export function isPermanentAlertHeartbeatError(error: unknown) {
  return ["BAD_REQUEST", "NOT_FOUND", "CONFLICT"].includes(trpcErrorCode(error) ?? "");
}

export async function maintainAlertHeartbeat(
  acknowledge: (signal: AbortSignal) => Promise<unknown>,
  {
    signal,
    shouldContinue = () => true,
    intervalMs = heartbeatIntervalMs,
  }: {
    signal: AbortSignal;
    shouldContinue?: () => boolean;
    intervalMs?: number;
  },
) {
  while (!signal.aborted && shouldContinue()) {
    let nextDelayMs = intervalMs;
    try {
      await attemptAcknowledgement(acknowledge, acknowledgementAttemptTimeoutMs, signal);
    } catch (error) {
      if (signal.aborted || !shouldContinue()) return;
      if (isPermanentAlertHeartbeatError(error)) throw error;
      nextDelayMs = Math.min(heartbeatFailureRetryMs, intervalMs);
    }

    try {
      await delay(nextDelayMs, signal);
    } catch {
      return;
    }
  }
}

function parseStreamEvent(line: string): AlertOverlayEvent {
  if (line.length > maximumStreamLineLength) {
    throw new AlertOverlayStreamError("event too large");
  }
  try {
    return parseJson(line, AlertOverlayEventSchema);
  } catch (cause) {
    if (cause instanceof RequestError) {
      throw new AlertOverlayStreamError("invalid event", { cause });
    }
    throw cause;
  }
}

export async function* streamAlertOverlay(
  identity: AlertOverlayOpen,
  token: string,
  signal: AbortSignal,
): AsyncIterable<AlertOverlayEvent> {
  let response: Response;
  try {
    response = await fetch("/api/alerts/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        playerId: identity.playerId,
        generation: identity.generation,
      }),
      signal,
    });
  } catch (cause) {
    if (signal.aborted) return;
    throw new AlertOverlayStreamError("fetch error", { cause });
  }
  if (!response.ok) {
    throw new AlertOverlayStreamError("http error", { status: response.status });
  }
  if (response.body === null) throw new AlertOverlayStreamError("missing body");

  for await (const line of readNdjsonLines(response.body, signal, {
    maximumLineLength: maximumStreamLineLength,
    readError: (cause) => new AlertOverlayStreamError("read error", { cause }),
    lineTooLongError: () => new AlertOverlayStreamError("event too large"),
  })) {
    yield parseStreamEvent(line);
  }
}

export function initialAlertSourceSignals(
  obsPresent: boolean,
  documentVisible = true,
): AlertSourceSignals {
  return {
    active: obsPresent ? null : true,
    documentVisible,
    obsPresent,
    obsVisible: obsPresent ? null : true,
    settled: !obsPresent,
  };
}

export function resolveAlertSourceState(signals: AlertSourceSignals): AlertSourceState {
  if (!signals.obsPresent) return { active: true, visible: true, ready: true };

  const visible =
    signals.obsVisible === null
      ? signals.settled
        ? signals.documentVisible
        : null
      : signals.documentVisible && signals.obsVisible;
  const active = signals.active ?? (signals.settled ? visible : null);
  return { active, visible, ready: active !== null && visible !== null };
}

export function settleAlertSourceSignals(signals: AlertSourceSignals): AlertSourceSignals {
  return { ...signals, settled: true };
}

export function resolveAlertFinishAcknowledgement(
  serverInterrupted: readonly AlertPlaybackId[],
  playbackId: AlertPlaybackId,
  outcome: "completed" | "interrupted",
) {
  const suppressed = outcome === "interrupted" && serverInterrupted.includes(playbackId);
  return {
    acknowledge: !suppressed,
    remaining: suppressed
      ? serverInterrupted.filter((candidate) => candidate !== playbackId)
      : serverInterrupted,
  };
}

function useObsSourceState() {
  const [signals, setSignals] = useState<AlertSourceSignals>({
    active: null,
    documentVisible: false,
    obsPresent: true,
    obsVisible: null,
    settled: false,
  });

  useEffect(() => {
    const obsPresent = Reflect.has(window, "obsstudio");
    setSignals(initialAlertSourceSignals(obsPresent, document.visibilityState === "visible"));
    if (!obsPresent) return;

    const settle = window.setTimeout(
      () => setSignals((current) => settleAlertSourceSignals(current)),
      obsReadinessSettleMs,
    );

    const activeChanged = (event: Event) => {
      const value = (event as ObsSourceEvent).detail?.active;
      if (typeof value === "boolean") {
        setSignals((current) => ({ ...current, active: value }));
      }
    };
    const visibleChanged = (event: Event) => {
      const value = (event as ObsSourceEvent).detail?.visible;
      if (typeof value === "boolean") {
        setSignals((current) => ({ ...current, obsVisible: value }));
      }
    };
    const documentVisibilityChanged = () => {
      setSignals((current) => ({
        ...current,
        documentVisible: document.visibilityState === "visible",
      }));
    };
    window.addEventListener("obsSourceActiveChanged", activeChanged);
    window.addEventListener("obsSourceVisibleChanged", visibleChanged);
    document.addEventListener("visibilitychange", documentVisibilityChanged);
    return () => {
      window.clearTimeout(settle);
      window.removeEventListener("obsSourceActiveChanged", activeChanged);
      window.removeEventListener("obsSourceVisibleChanged", visibleChanged);
      document.removeEventListener("visibilitychange", documentVisibilityChanged);
    };
  }, []);

  return resolveAlertSourceState(signals);
}

function sameIdentity(left: AlertOverlayOpen | null, right: AlertOverlayOpen) {
  return (
    left?.state === "active" &&
    left.playerId === right.playerId &&
    left.generation === right.generation
  );
}

function useAlertOverlayState() {
  const [identity, setIdentityState] = useState<AlertOverlayOpen | null>(null);
  const identityRef = useRef<AlertOverlayOpen | null>(null);
  const [playback, setPlayback] = useState<AlertPlayback | null>(null);
  const playbackRef = useRef<AlertPlayback | null>(null);
  const serverInterrupted = useRef<readonly AlertPlaybackId[]>([]);
  const sentDiagnostics = useRef<readonly string[]>([]);
  const [interruptionKey, setInterruptionKey] = useState(0);
  const [openCycle, setOpenCycle] = useState(0);
  const setIdentity = useCallback((next: AlertOverlayOpen | null) => {
    identityRef.current = next;
    setIdentityState(next);
  }, []);
  const setCurrentPlayback = useCallback((next: AlertPlayback | null) => {
    if (playbackRef.current?.playbackId !== next?.playbackId) sentDiagnostics.current = [];
    playbackRef.current = next;
    setPlayback(next);
  }, []);
  const suppressServerInterruptedPlayback = useCallback(() => {
    const current = playbackRef.current;
    if (current && !serverInterrupted.current.includes(current.playbackId)) {
      serverInterrupted.current = [...serverInterrupted.current, current.playbackId];
    }
    setCurrentPlayback(null);
  }, [setCurrentPlayback]);
  const invalidateIdentity = useCallback(
    (failedIdentity: AlertOverlayOpen) => {
      if (!sameIdentity(identityRef.current, failedIdentity)) return;
      setCurrentPlayback(null);
      setIdentity(null);
      setOpenCycle((cycle) => cycle + 1);
    },
    [setCurrentPlayback, setIdentity],
  );

  return {
    identity,
    identityRef,
    interruptionKey,
    invalidateIdentity,
    openCycle,
    playback,
    playbackRef,
    sentDiagnostics,
    serverInterrupted,
    setCurrentPlayback,
    setIdentity,
    setInterruptionKey,
    suppressServerInterruptedPlayback,
  };
}

type OverlayState = ReturnType<typeof useAlertOverlayState>;
type TrpcClient = Api["trpcClient"];

function useReleaseInactiveClaim(canClaim: boolean, state: OverlayState) {
  const { identity, setCurrentPlayback, setIdentity } = state;

  useEffect(() => {
    if (canClaim || identity === null) return;
    if (identity.state === "active") setCurrentPlayback(null);
    setIdentity(null);
  }, [canClaim, identity, setCurrentPlayback, setIdentity]);
}

function useOpenAlertOverlay(
  token: string,
  canClaim: boolean,
  trpcClient: TrpcClient,
  state: OverlayState,
) {
  const { openCycle, setIdentity } = state;

  useEffect(() => {
    if (!canClaim) return;
    const abort = new AbortController();
    let timeout: number | undefined;
    const attempt = async () => {
      try {
        const next = await attemptAcknowledgement(
          (signal) => trpcClient.alerts.openOverlay.mutate({ token }, { signal }),
          acknowledgementAttemptTimeoutMs,
          abort.signal,
        );
        if (abort.signal.aborted) return;
        setIdentity(next);
        if (next.state === "standby") {
          const untilLease = next.leaseExpiresAt.getTime() - Date.now() + 250;
          timeout = window.setTimeout(attempt, Math.max(2_000, Math.min(5_000, untilLease)));
        }
      } catch {
        if (!abort.signal.aborted) {
          setIdentity(null);
          timeout = window.setTimeout(attempt, 5_000);
        }
      }
    };
    void attempt();
    return () => {
      abort.abort();
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [canClaim, openCycle, token, trpcClient]);
}

function useAlertEventStream(token: string, canClaim: boolean, state: OverlayState) {
  const {
    identity,
    invalidateIdentity,
    setCurrentPlayback,
    setInterruptionKey,
    suppressServerInterruptedPlayback,
  } = state;

  useEffect(() => {
    if (identity?.state !== "active" || !canClaim) return;
    const abort = new AbortController();
    const run = async () => {
      try {
        for await (const event of streamAlertOverlay(identity, token, abort.signal)) {
          if (event.type === "playback") setCurrentPlayback(event.playback);
          if (event.type === "control" && event.action === "skip") {
            setInterruptionKey((key) => key + 1);
            suppressServerInterruptedPlayback();
          }
          if (event.type === "revoked") {
            suppressServerInterruptedPlayback();
            break;
          }
        }
      } catch {
        if (abort.signal.aborted) return;
      }
      if (!abort.signal.aborted) invalidateIdentity(identity);
    };
    void run();
    return () => abort.abort();
  }, [
    canClaim,
    identity,
    invalidateIdentity,
    setCurrentPlayback,
    suppressServerInterruptedPlayback,
    token,
  ]);
}

function useAlertHeartbeat(
  token: string,
  source: AlertSourceState,
  trpcClient: TrpcClient,
  state: OverlayState,
) {
  const { identity, identityRef, invalidateIdentity } = state;

  useEffect(() => {
    if (identity?.state !== "active") return;
    const abort = new AbortController();
    void maintainAlertHeartbeat(
      (signal) =>
        trpcClient.alerts.heartbeat.mutate(
          {
            token,
            playerId: identity.playerId,
            generation: identity.generation,
            active: source.active === true,
            visible: source.visible === true,
          },
          { signal },
        ),
      {
        signal: abort.signal,
        shouldContinue: () => sameIdentity(identityRef.current, identity),
      },
    ).catch((error: unknown) => {
      if (!abort.signal.aborted && isPermanentAlertHeartbeatError(error)) {
        invalidateIdentity(identity);
      }
    });
    return () => {
      abort.abort();
    };
  }, [identity, invalidateIdentity, source.active, source.visible, token, trpcClient]);
}

function useStartedAcknowledgement(token: string, trpcClient: TrpcClient, state: OverlayState) {
  const { identity, identityRef, invalidateIdentity, playbackRef } = state;

  return useCallback(
    async (playbackId: AlertPlaybackId, signal: AbortSignal) => {
      const activeIdentity = identity;
      if (activeIdentity?.state !== "active") throw abortError();
      try {
        await retryAlertAcknowledgement(
          (attemptSignal) =>
            trpcClient.alerts.started.mutate(
              {
                token,
                playerId: activeIdentity.playerId,
                generation: activeIdentity.generation,
                playbackId,
              },
              { signal: attemptSignal },
            ),
          {
            signal,
            shouldContinue: () =>
              sameIdentity(identityRef.current, activeIdentity) &&
              playbackRef.current?.playbackId === playbackId,
            timeoutMs: startAcknowledgementTimeoutMs,
          },
        );
      } catch (error) {
        if (error instanceof AlertAcknowledgementTimeoutError) {
          invalidateIdentity(activeIdentity);
        }
        throw error;
      }
    },
    [identity, invalidateIdentity, token, trpcClient],
  );
}

function useFinishedAcknowledgement(token: string, trpcClient: TrpcClient, state: OverlayState) {
  const { identity, identityRef, playbackRef, serverInterrupted, setCurrentPlayback } = state;

  return useCallback(
    async (playbackId: AlertPlaybackId, outcome: "completed" | "interrupted") => {
      const acknowledgement = resolveAlertFinishAcknowledgement(
        serverInterrupted.current,
        playbackId,
        outcome,
      );
      serverInterrupted.current = acknowledgement.remaining;
      if (!acknowledgement.acknowledge) return;

      const activeIdentity = identity;
      if (activeIdentity?.state !== "active") return;
      const abort = new AbortController();
      try {
        await retryAlertAcknowledgement(
          (attemptSignal) =>
            trpcClient.alerts.finished.mutate(
              {
                token,
                playerId: activeIdentity.playerId,
                generation: activeIdentity.generation,
                playbackId,
                outcome,
              },
              { signal: attemptSignal },
            ),
          {
            signal: abort.signal,
            shouldContinue: () =>
              sameIdentity(identityRef.current, activeIdentity) &&
              playbackRef.current?.playbackId === playbackId,
            timeoutMs: finishAcknowledgementTimeoutMs,
          },
        );
        if (playbackRef.current?.playbackId === playbackId) setCurrentPlayback(null);
      } catch {
        // A server control, revocation, or replacement playback owns recovery from here.
      } finally {
        abort.abort();
      }
    },
    [identity, setCurrentPlayback, token, trpcClient],
  );
}

function useDiagnosticAcknowledgement(token: string, trpcClient: TrpcClient, state: OverlayState) {
  const { identity, identityRef, playbackRef, sentDiagnostics } = state;

  return useCallback(
    async (playbackId: AlertPlaybackId, code: AlertRendererDiagnosticCode, signal: AbortSignal) => {
      const activeIdentity = identity;
      if (activeIdentity?.state !== "active" || playbackRef.current?.playbackId !== playbackId) {
        return;
      }
      const key = `${playbackId}:${code}`;
      if (sentDiagnostics.current.includes(key)) return;
      sentDiagnostics.current = [...sentDiagnostics.current, key];

      await retryAlertAcknowledgement(
        (attemptSignal) =>
          trpcClient.alerts.diagnostic.mutate(
            {
              token,
              playerId: activeIdentity.playerId,
              generation: activeIdentity.generation,
              playbackId,
              code,
            },
            { signal: attemptSignal },
          ),
        {
          signal,
          shouldContinue: () =>
            sameIdentity(identityRef.current, activeIdentity) &&
            playbackRef.current?.playbackId === playbackId,
          timeoutMs: diagnosticAcknowledgementTimeoutMs,
        },
      ).catch(() => undefined);
    },
    [identity, token, trpcClient],
  );
}

export function useAlertOverlay(token: string) {
  const { trpcClient } = useApi();
  const source = useObsSourceState();
  const state = useAlertOverlayState();
  const canClaim = source.ready && source.active === true && source.visible === true;

  useReleaseInactiveClaim(canClaim, state);
  useOpenAlertOverlay(token, canClaim, trpcClient, state);
  useAlertEventStream(token, canClaim, state);
  useAlertHeartbeat(token, source, trpcClient, state);
  const onStarted = useStartedAcknowledgement(token, trpcClient, state);
  const onFinished = useFinishedAcknowledgement(token, trpcClient, state);
  const onDiagnostic = useDiagnosticAcknowledgement(token, trpcClient, state);

  return {
    active: state.identity?.state === "active" && canClaim,
    identity: state.identity,
    interruptionKey: state.interruptionKey,
    onDiagnostic,
    onFinished,
    onStarted,
    playback: state.playback,
  };
}
