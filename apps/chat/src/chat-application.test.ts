import type { ChatConfig, ChatProvider, ChatStreamEvent } from "@coldbrew/packages/chat.js";
import { ChatSourceIdSchema, type ChatSourceId } from "@coldbrew/packages/chat.js";
import { erro } from "@lebedevna/neverthrow-utils";
import { ok } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import {
  ChatApplication,
  type ChatAuditEntry,
  type ChatCollectorControl,
  type ChatEventBroker,
  type ChatRepository,
} from "./chat-application.js";
import type { ChatProviderAdapter, ConnectedChatSource } from "./provider.js";

const youtubeSourceId = ChatSourceIdSchema.parse("00000000-0000-4000-8000-000000000001");
const twitchSourceId = ChatSourceIdSchema.parse("00000000-0000-4000-8000-000000000002");
const boostySourceId = ChatSourceIdSchema.parse("00000000-0000-4000-8000-000000000003");

function source(
  sourceId: ChatSourceId,
  provider: ChatProvider,
  capabilities: ConnectedChatSource["capabilities"],
): ConnectedChatSource {
  return {
    source: {
      sourceId,
      connectionId: `10000000-0000-4000-8000-00000000000${sourceId.at(-1)}`,
      provider,
      providerSourceId: `${provider}-channel`,
      displayName: `${provider} channel`,
      sourceUrl: `https://example.com/${provider}`,
      position: Number(sourceId.at(-1)) - 1,
      enabled: true,
    },
    capabilities,
    credentials: { scopes: [], tokenVersion: 1 },
  };
}

function adapter(
  provider: Extract<ChatProvider, "youtube" | "twitch">,
  send: ChatProviderAdapter["sendMessage"],
): ChatProviderAdapter {
  return {
    provider,
    collection: "pull",
    async *stream() {},
    sendMessage: send,
    async moderate() {
      return ok({});
    },
  };
}

function setup() {
  const sources = [
    source(youtubeSourceId, "youtube", ["read", "send_message", "delete_message"]),
    source(twitchSourceId, "twitch", ["read", "send_message"]),
    source(boostySourceId, "boosty", ["read"]),
  ];
  const audit: ChatAuditEntry[] = [];
  const published: ChatStreamEvent[] = [];
  const repository: ChatRepository = {
    async getConfig() {
      return { connections: [], sources: [], hasOverlayToken: false } satisfies ChatConfig;
    },
    async getEnabledSources() {
      return sources;
    },
    async getSource(_userId, sourceId) {
      return sources.find(({ source: current }) => current.sourceId === sourceId) ?? null;
    },
    async getProviderBanId() {
      return null;
    },
    async saveProviderBanId() {},
    async deleteProviderBanId() {},
    async recordAction(entry) {
      audit.push(entry);
    },
  };
  const broker: ChatEventBroker = {
    async publish(_userId, event) {
      published.push(event);
    },
    async *stream() {},
  };
  const youtubeSend = vi.fn(async () => ok(undefined));
  const twitchSend = vi.fn(async () =>
    erro({ type: "provider unavailable" as const, detail: "Twitch unavailable" }),
  );
  const refreshes: ChatSourceId[] = [];
  const collectorControl: ChatCollectorControl = {
    async requestRefresh(sourceId) {
      refreshes.push(sourceId);
    },
  };
  const application = new ChatApplication(
    repository,
    broker,
    [adapter("youtube", youtubeSend), adapter("twitch", twitchSend)],
    collectorControl,
  );
  return { application, audit, published, refreshes, youtubeSend, twitchSend };
}

describe("chat application", () => {
  it("broadcasts concurrently and preserves one result per source", async () => {
    const { application, audit, youtubeSend, twitchSend } = setup();
    const $result = await application.broadcast(42, " hello ", new AbortController().signal);

    expect($result._unsafeUnwrap().results).toEqual([
      { sourceId: youtubeSourceId, status: "succeeded" },
      { sourceId: twitchSourceId, status: "failed", detail: "Twitch unavailable" },
      {
        sourceId: boostySourceId,
        status: "unsupported",
        detail: "This provider connection is read-only",
      },
    ]);
    expect(youtubeSend).toHaveBeenCalledWith(expect.anything(), "hello", expect.anything());
    expect(twitchSend).toHaveBeenCalledWith(expect.anything(), "hello", expect.anything());
    expect(audit).toHaveLength(3);
    expect(audit).not.toEqual(expect.arrayContaining([expect.objectContaining({ text: "hello" })]));
  });

  it("publishes a deletion event after provider confirmation", async () => {
    const { application, published } = setup();
    const $result = await application.moderate(
      42,
      { type: "delete_message", sourceId: youtubeSourceId, messageId: "message-1" },
      new AbortController().signal,
    );

    expect($result._unsafeUnwrap()).toEqual({ sourceId: youtubeSourceId, status: "succeeded" });
    expect(published).toEqual([
      { type: "message_deleted", sourceId: youtubeSourceId, messageId: "message-1" },
    ]);
  });

  it("requests manual discovery for an owned YouTube source", async () => {
    const { application, refreshes } = setup();

    const $result = await application.refreshSource(42, youtubeSourceId);

    expect($result.isOk()).toBe(true);
    expect(refreshes).toEqual([youtubeSourceId]);
  });

  it("rejects manual discovery for other providers", async () => {
    const { application, refreshes } = setup();

    const $result = await application.refreshSource(42, twitchSourceId);

    expect($result._unsafeUnwrapErr()).toMatchObject({
      type: "chat source refresh unsupported",
    });
    expect(refreshes).toEqual([]);
  });
});
