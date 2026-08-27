import { describe, expect, it } from "vitest";

import {
  initialChatEditorState,
  initialChatStreamState,
  reduceChatEditorState,
  reduceChatStreamState,
} from "./chat-state.js";
import type { ChatMessage } from "./chat.js";

function message(id: string, occurredAt: string): ChatMessage {
  return {
    id,
    provider: "youtube",
    sourceIdentifier: "video-id",
    author: "Viewer",
    text: id,
    occurredAt: new Date(occurredAt),
  };
}

describe("chat stream state", () => {
  it("updates source state and deduplicates sorted messages", () => {
    const live = reduceChatStreamState(initialChatStreamState, {
      type: "event received",
      event: {
        type: "state",
        provider: "youtube",
        sourceIdentifier: "video-id",
        state: "live",
      },
    });
    const later = reduceChatStreamState(live, {
      type: "event received",
      event: { type: "message", message: message("same-id", "2026-08-27T12:01:00Z") },
    });
    const replaced = reduceChatStreamState(later, {
      type: "event received",
      event: { type: "message", message: message("same-id", "2026-08-27T12:00:00Z") },
    });

    expect(replaced.statuses).toEqual({ "youtube:video-id": "live" });
    expect(replaced.messages).toEqual([message("same-id", "2026-08-27T12:00:00Z")]);
    expect(later.messages[0]!.occurredAt).toEqual(new Date("2026-08-27T12:01:00Z"));
  });

  it("resets messages, statuses, and connection errors together", () => {
    const failed = reduceChatStreamState(initialChatStreamState, {
      type: "connection error",
      error: { code: "transport_unavailable", detail: "Connection interrupted" },
    });
    expect(reduceChatStreamState(failed, { type: "reset" })).toEqual(initialChatStreamState);
  });

  it("stores a safe connection error received as stream data", () => {
    const failed = reduceChatStreamState(initialChatStreamState, {
      type: "event received",
      event: {
        type: "connection_error",
        error: { code: "session_limit", detail: "Too many chat connections are already open" },
      },
    });

    expect(failed.connectionError).toEqual({
      code: "session_limit",
      detail: "Too many chat connections are already open",
    });
  });
});

describe("chat editor state", () => {
  it("canonicalizes, rejects duplicates, and removes sources immutably", () => {
    const entered = reduceChatEditorState(initialChatEditorState, {
      type: "input changed",
      input: "https://youtube.com/watch?v=abcdefghijk",
    });
    const added = reduceChatEditorState(entered, {
      type: "source added",
    });
    const duplicateEntered = reduceChatEditorState(added, {
      type: "input changed",
      input: "https://youtu.be/abcdefghijk",
    });
    const duplicate = reduceChatEditorState(duplicateEntered, {
      type: "source added",
    });
    const removed = reduceChatEditorState(duplicate, { type: "source removed", index: 0 });

    expect(added.sources).toEqual([
      expect.objectContaining({ sourceUrl: "https://www.youtube.com/watch?v=abcdefghijk" }),
    ]);
    expect(duplicate.inputError).toBe("duplicate");
    expect(removed.sources).toEqual([]);
    expect(initialChatEditorState.sources).toEqual([]);
  });
});
