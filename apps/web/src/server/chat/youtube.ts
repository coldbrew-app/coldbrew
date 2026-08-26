import { credentials, loadPackageDefinition, Metadata, type ServiceError } from "@grpc/grpc-js";
import { fromJSON } from "@grpc/proto-loader";
import type { ChatMessage, ChatSourceState } from "@web/lib/chat.js";
import { ResultAsync } from "neverthrow";
import { z } from "zod";

import { env } from "../env.js";

type Emit = {
  message: (message: ChatMessage) => void;
  state: (state: ChatSourceState, detail?: string) => void;
};

const VideoResponseSchema = z.object({
  items: z.array(
    z.object({
      liveStreamingDetails: z
        .object({
          activeLiveChatId: z.string().optional(),
        })
        .optional(),
    }),
  ),
});
const StreamResponseSchema = z.object({
  nextPageToken: z.string().optional(),
  offlineAt: z.union([z.string(), z.number(), z.bigint()]).optional(),
  items: z
    .array(
      z.object({
        id: z.string(),
        snippet: z.object({
          type: z.union([z.literal("TEXT_MESSAGE_EVENT"), z.literal(1)]),
          publishedAt: z.string(),
          displayMessage: z.string().optional(),
          textMessageDetails: z
            .object({
              messageText: z.string(),
            })
            .optional(),
        }),
        authorDetails: z.object({
          displayName: z.string(),
        }),
      }),
    )
    .default([]),
});

type DynamicClient = {
  streamList: (
    request: Record<string, unknown>,
    metadata: Metadata,
  ) => {
    cancel: () => void;
    on: (event: string, listener: (value: unknown) => void) => void;
  };
  close: () => void;
};

const protoDefinition: Parameters<typeof fromJSON>[0] = {
  nested: {
    youtube: {
      nested: {
        api: {
          nested: {
            v3: {
              nested: {
                LiveChatMessageListRequest: {
                  fields: {
                    liveChatId: { id: 1, type: "string" },
                    part: { id: 2, rule: "repeated", type: "string" },
                    pageToken: { id: 4, type: "string" },
                    maxResults: { id: 98, type: "uint32" },
                  },
                },
                LiveChatMessageListResponse: {
                  fields: {
                    nextPageToken: { id: 100602, type: "string" },
                    offlineAt: { id: 2, type: "int64" },
                    items: { id: 1007, rule: "repeated", type: "LiveChatMessage" },
                  },
                },
                LiveChatMessage: {
                  fields: {
                    id: { id: 101, type: "string" },
                    snippet: { id: 2, type: "LiveChatMessageSnippet" },
                    authorDetails: { id: 3, type: "LiveChatMessageAuthorDetails" },
                  },
                },
                LiveChatMessageAuthorDetails: {
                  fields: {
                    channelId: { id: 10101, type: "string" },
                    displayName: { id: 103, type: "string" },
                  },
                },
                LiveChatMessageSnippet: {
                  fields: {
                    type: { id: 1, type: "Type" },
                    publishedAt: { id: 4, type: "string" },
                    displayMessage: { id: 16, type: "string" },
                    textMessageDetails: { id: 19, type: "LiveChatTextMessageDetails" },
                  },
                  nested: {
                    Type: {
                      values: { INVALID: 0, TEXT_MESSAGE_EVENT: 1 },
                    },
                  },
                },
                LiveChatTextMessageDetails: {
                  fields: { messageText: { id: 1, type: "string" } },
                },
                V3DataLiveChatMessageService: {
                  methods: {
                    StreamList: {
                      comment: "Streams live chat messages.",
                      requestType: "LiveChatMessageListRequest",
                      responseStream: true,
                      responseType: "LiveChatMessageListResponse",
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

function createClient() {
  const definition = loadPackageDefinition(
    fromJSON(protoDefinition, { defaults: true, enums: String, keepCase: false, longs: String }),
  ) as Record<string, unknown>;
  const namespace = (definition.youtube as Record<string, unknown>).api as Record<string, unknown>;
  const service = (namespace.v3 as Record<string, unknown>).V3DataLiveChatMessageService as new (
    address: string,
    creds: ReturnType<typeof credentials.createSsl>,
  ) => DynamicClient;
  return new service("youtube.googleapis.com:443", credentials.createSsl());
}

export async function runYoutubeCollector(
  videoId: string,
  emit: Emit,
  signal: AbortSignal,
  pageToken?: string,
) {
  const apiKey = env.YOUTUBE_API_KEY;
  if (!apiKey) {
    emit.state("error", "YOUTUBE_API_KEY is not configured");
    return pageToken;
  }
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.search = new URLSearchParams({
    id: videoId,
    key: apiKey,
    part: "liveStreamingDetails",
  }).toString();
  const $response = await ResultAsync.fromPromise(fetch(url, { signal }), (error) => error);
  if ($response.isErr() || !$response.value.ok) {
    emit.state("error", "Could not read the YouTube live stream");
    return pageToken;
  }
  const $body = await ResultAsync.fromPromise($response.value.json(), (error) => error);
  const parsed = $body.isOk() ? VideoResponseSchema.safeParse($body.value) : null;
  const liveChatId = parsed?.success
    ? parsed.data.items[0]?.liveStreamingDetails?.activeLiveChatId
    : null;
  if (!liveChatId) {
    emit.state("offline");
    return undefined;
  }

  const client = createClient();
  const metadata = new Metadata();
  metadata.set("x-goog-api-key", apiKey);
  const stream = client.streamList(
    {
      liveChatId,
      maxResults: 200,
      pageToken,
      part: ["snippet", "authorDetails"],
    },
    metadata,
  );
  const abort = () => stream.cancel();
  signal.addEventListener("abort", abort, { once: true });
  emit.state("live");
  let nextPageToken = pageToken;
  stream.on("data", (value) => {
    const parsedResponse = StreamResponseSchema.safeParse(value);
    if (!parsedResponse.success) return;
    nextPageToken = parsedResponse.data.nextPageToken || nextPageToken;
    for (const item of parsedResponse.data.items) {
      emit.message({
        id: item.id,
        provider: "youtube",
        sourceIdentifier: videoId,
        author: item.authorDetails.displayName,
        text: item.snippet.textMessageDetails?.messageText ?? item.snippet.displayMessage ?? "",
        occurredAt: new Date(item.snippet.publishedAt),
      });
    }
    if (parsedResponse.data.offlineAt && BigInt(parsedResponse.data.offlineAt) > 0n) {
      emit.state("offline");
    }
  });
  stream.on("error", (error) => {
    if (!signal.aborted) emit.state("error", (error as ServiceError).message);
  });
  await new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
    stream.on("end", () => resolve());
  });
  signal.removeEventListener("abort", abort);
  client.close();
  return nextPageToken;
}
