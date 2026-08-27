import type { ChatMessage, ChatSource, ChatSourceState, ChatStreamEvent } from "@web/lib/chat.js";
import delay from "delay";

import { AsyncQueue } from "./async-queue.js";
import { twitchChatGateway } from "./twitch.js";
import { runYoutubeCollector } from "./youtube.js";

const BUFFER_SIZE = 200;
const GRACE_PERIOD_MS = 90_000;
const MAX_SESSIONS = 3;

type Listener = (event: ChatStreamEvent) => void;

class Collector {
  private readonly listeners = new Set<Listener>();
  private readonly messages: ChatMessage[] = [];
  private readonly messageIds = new Set<string>();
  private controller: AbortController | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private state: ChatSourceState = "connecting";
  private detail?: string;

  constructor(
    readonly source: ChatSource,
    private readonly onIdle: () => void,
  ) {}

  subscribe(listener: Listener) {
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.stopTimer = null;
    this.listeners.add(listener);
    listener(this.stateEvent());
    for (const message of this.messages) listener({ type: "message", message });
    if (!this.controller) this.start();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.stopTimer = setTimeout(() => this.stop(), GRACE_PERIOD_MS);
      }
    };
  }

  get idle() {
    return this.listeners.size === 0 && this.controller === null;
  }

  private start() {
    this.controller = new AbortController();
    this.setState("connecting");
    const emit = {
      message: (message: ChatMessage) => this.onMessage(message),
      state: (state: ChatSourceState, detail?: string) => this.setState(state, detail),
    };
    const signal = this.controller.signal;
    void this.runLoop(emit, signal).finally(() => {
      this.controller = null;
      this.onIdle();
    });
  }

  private async runLoop(
    emit: {
      message: (message: ChatMessage) => void;
      state: (state: ChatSourceState, detail?: string) => void;
    },
    signal: AbortSignal,
  ) {
    let retryMs = 5_000;
    let youtubePageToken: string | undefined;
    while (!signal.aborted) {
      switch (this.source.provider) {
        case "youtube":
          youtubePageToken = await runYoutubeCollector(
            this.source.sourceIdentifier,
            emit,
            signal,
            youtubePageToken,
          );
          break;
        case "twitch":
          await twitchChatGateway.subscribe(this.source.sourceIdentifier, emit, signal);
          break;
      }

      if (signal.aborted) return;

      await delay(retryMs, { signal });
      retryMs = Math.min(retryMs * 2, 60_000);

      if (!signal.aborted) this.setState("connecting");
    }
  }

  private stop() {
    this.stopTimer = null;
    this.controller?.abort();
  }

  private onMessage(message: ChatMessage) {
    if (this.messageIds.has(message.id)) return;
    this.messageIds.add(message.id);
    this.messages.push(message);
    if (this.messages.length > BUFFER_SIZE) {
      const removed = this.messages.shift();
      if (removed) this.messageIds.delete(removed.id);
    }
    this.emit({ type: "message", message });
  }

  private setState(state: ChatSourceState, detail?: string) {
    this.state = state;
    this.detail = detail;
    this.emit(this.stateEvent());
  }

  private stateEvent(): ChatStreamEvent {
    return {
      type: "state",
      provider: this.source.provider,
      sourceIdentifier: this.source.sourceIdentifier,
      state: this.state,
      ...(this.detail ? { detail: this.detail } : {}),
    };
  }

  private emit(event: ChatStreamEvent) {
    for (const listener of this.listeners) listener(event);
  }
}

class ChatCollectorRegistry {
  private readonly collectors = new Map<string, Collector>();
  private readonly sessionCounts = new Map<string, number>();

  async *stream(sessionKey: string, sources: readonly ChatSource[], signal: AbortSignal) {
    const sessionCount = this.sessionCounts.get(sessionKey) ?? 0;
    if (sessionCount >= MAX_SESSIONS) throw new Error("Too many concurrent chat sessions.");
    this.sessionCounts.set(sessionKey, sessionCount + 1);
    const queue = new AsyncQueue<ChatStreamEvent>();
    const releases = sources.map((source) =>
      this.acquire(source).subscribe((event) => queue.push(event)),
    );
    const close = () => queue.close();
    signal.addEventListener("abort", close, { once: true });
    try {
      yield* queue;
    } finally {
      signal.removeEventListener("abort", close);
      for (const release of releases) release();
      const nextCount = (this.sessionCounts.get(sessionKey) ?? 1) - 1;
      if (nextCount === 0) this.sessionCounts.delete(sessionKey);
      else this.sessionCounts.set(sessionKey, nextCount);
      this.prune();
    }
  }

  private acquire(source: ChatSource) {
    const key = `${source.provider}:${source.sourceIdentifier}`;
    const existing = this.collectors.get(key);
    if (existing) return existing;
    const collector = new Collector(source, () => this.prune());
    this.collectors.set(key, collector);
    return collector;
  }

  private prune() {
    for (const [key, collector] of this.collectors) {
      if (collector.idle) this.collectors.delete(key);
    }
  }
}

export const chatCollectorRegistry = new ChatCollectorRegistry();
