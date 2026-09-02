import { ClientError, Status } from "nice-grpc-common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { YoutubeLiveChatClient } from "./youtube-live-chat.js";
import {
  LiveChatMessageSnippet_TypeWrapper_Type,
  type V3DataLiveChatMessageServiceClient,
} from "./youtube-live-chat/generated/stream_list.js";

const mocks = vi.hoisted(() => ({
  close: vi.fn<() => void>(),
  streamList: vi.fn<V3DataLiveChatMessageServiceClient["streamList"]>(),
}));

function iteratorValue<T>(result: IteratorResult<T>) {
  if (result.done === true) {
    throw new Error("Expected the YouTube live chat stream to yield a value.");
  }
  return result.value;
}

async function nextValue<T>(iterator: AsyncIterator<T>) {
  return iteratorValue(await iterator.next());
}

vi.mock("nice-grpc", () => ({
  ChannelCredentials: { createSsl: vi.fn(() => "credentials") },
  createChannel: vi.fn(() => ({ close: mocks.close })),
  createClient: vi.fn(() => ({ streamList: mocks.streamList })),
  Metadata: vi.fn((values: Record<string, string>) => values),
}));

describe("YouTube live chat client", () => {
  beforeEach(() => {
    mocks.close.mockReset();
    mocks.streamList.mockReset();
  });

  afterEach(() => vi.useRealTimers());

  it("streams a discovered live chat with OAuth and normalizes messages", async () => {
    mocks.streamList.mockReturnValue(
      (async function* () {
        yield {
          items: [
            {
              id: "message-1",
              snippet: {
                type: LiveChatMessageSnippet_TypeWrapper_Type.TEXT_MESSAGE_EVENT,
                publishedAt: "2026-08-31T10:00:00.000Z",
                textMessageDetails: { messageText: "hello" },
              },
              authorDetails: { channelId: "author-1", displayName: "Viewer" },
            },
          ],
          nextPageToken: "page-2",
        };
        yield { items: [], offlineAt: "2026-08-31T10:01:00.000Z" };
      })(),
    );
    const iterator = new YoutubeLiveChatClient()
      .stream({ liveChatId: "live-chat-1", accessToken: "access-token" })
      [Symbol.asyncIterator]();

    expect((await nextValue(iterator))._unsafeUnwrap()).toEqual({
      type: "state",
      state: "connecting",
    });
    expect((await nextValue(iterator))._unsafeUnwrap()).toEqual({
      type: "state",
      state: "live",
    });
    expect((await nextValue(iterator))._unsafeUnwrap()).toEqual({
      type: "item",
      item: {
        kind: "text",
        id: "message-1",
        authorId: "author-1",
        author: "Viewer",
        text: "hello",
        occurredAt: new Date("2026-08-31T10:00:00.000Z"),
      },
    });
    expect((await nextValue(iterator))._unsafeUnwrap()).toEqual({
      type: "state",
      state: "offline",
    });
    expect((await iterator.next()).done).toBe(true);
    expect(mocks.streamList).toHaveBeenCalledOnce();
    const firstCall = mocks.streamList.mock.calls[0];
    expect(firstCall[0]).toEqual({
      liveChatId: "live-chat-1",
      pageToken: undefined,
      part: ["snippet", "authorDetails"],
    });
    expect(firstCall[1]?.metadata).toEqual({ authorization: "Bearer access-token" });
    expect(firstCall[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("reconnects from the last cursor and resets backoff after empty responses", async () => {
    vi.useFakeTimers();
    mocks.streamList
      .mockReturnValueOnce(
        (async function* () {
          yield { items: [], nextPageToken: "page-2" };
        })(),
      )
      .mockReturnValueOnce(
        (async function* () {
          yield { items: [], nextPageToken: "page-3" };
        })(),
      )
      .mockReturnValueOnce(
        (async function* () {
          yield { items: [], offlineAt: "2026-08-31T10:01:00.000Z" };
        })(),
      );
    const iterator = new YoutubeLiveChatClient()
      .stream({ liveChatId: "live-chat-1", accessToken: "access-token" })
      [Symbol.asyncIterator]();

    await iterator.next();
    await iterator.next();
    const firstReconnect = iterator.next();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(iteratorValue(await firstReconnect)._unsafeUnwrap()).toEqual({
      type: "state",
      state: "connecting",
    });
    await iterator.next();
    const secondReconnect = iterator.next();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(iteratorValue(await secondReconnect)._unsafeUnwrap()).toEqual({
      type: "state",
      state: "connecting",
    });
    await iterator.next();
    expect((await nextValue(iterator))._unsafeUnwrap()).toEqual({
      type: "state",
      state: "offline",
    });

    expect(mocks.streamList.mock.calls[1]?.[0]).toMatchObject({ pageToken: "page-2" });
    expect(mocks.streamList.mock.calls[2]?.[0]).toMatchObject({ pageToken: "page-3" });
  });

  it("returns terminal OAuth failures without retrying", async () => {
    mocks.streamList.mockReturnValue({
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            throw new ClientError("/youtube/streamList", Status.UNAUTHENTICATED, "expired");
          },
          return: async () => ({ done: true as const, value: undefined }),
        };
      },
    });
    const iterator = new YoutubeLiveChatClient()
      .stream({ liveChatId: "live-chat-1", accessToken: "expired-token" })
      [Symbol.asyncIterator]();

    await iterator.next();
    await iterator.next();
    const failed = await nextValue(iterator);

    expect(failed._unsafeUnwrapErr()).toMatchObject({
      type: "youtube live chat error",
      operation: "read",
      reason: "unauthorized",
      isAbort: false,
    });
    expect((await iterator.next()).done).toBe(true);
    expect(mocks.streamList).toHaveBeenCalledOnce();
  });
});
