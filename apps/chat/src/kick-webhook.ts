import { createVerify } from "node:crypto";

import { erro, parseJson, validate } from "@lebedevna/neverthrow-utils";
import { ok, Result, safeTry, type Result as NeverthrowResult } from "neverthrow";
import { z } from "zod";

import type { ChatEventBroker } from "./chat-application.js";
import type { ChatStore } from "./store.js";

const WEBHOOK_CLOCK_SKEW_MS = 5 * 60 * 1_000;

const KickIdentitySchema = z.object({
  user_id: z.union([z.string(), z.number()]).transform(String),
  username: z.string().min(1),
});

const KickMessageSchema = z.object({
  message_id: z.string().min(1),
  broadcaster: KickIdentitySchema,
  sender: KickIdentitySchema,
  content: z.string(),
  created_at: z.string().datetime(),
});

type KickWebhookError = Readonly<{
  type: "invalid kick webhook" | "unknown kick source";
  detail: string;
  cause?: unknown;
}>;

function requiredHeader(headers: Headers, name: string) {
  const value = headers.get(name);
  return value !== null
    ? ok(value)
    : erro<KickWebhookError>({ type: "invalid kick webhook", detail: `${name} is missing` });
}

function verifySignature(
  publicKey: string,
  messageId: string,
  timestamp: string,
  body: string,
  signature: string,
): NeverthrowResult<void, KickWebhookError> {
  const occurredAt = Date.parse(timestamp);
  if (!Number.isFinite(occurredAt) || Math.abs(Date.now() - occurredAt) > WEBHOOK_CLOCK_SKEW_MS) {
    return erro({ type: "invalid kick webhook", detail: "Kick webhook timestamp is stale" });
  }
  return Result.fromThrowable(
    () => {
      const verifier = createVerify("RSA-SHA256");
      verifier.update(`${messageId}.${timestamp}.${body}`);
      verifier.end();
      if (!verifier.verify(publicKey.replaceAll("\\n", "\n"), signature, "base64")) {
        throw new Error("Signature mismatch");
      }
    },
    (cause): KickWebhookError => ({
      type: "invalid kick webhook",
      detail: "Kick webhook signature is invalid",
      cause,
    }),
  )();
}

export class KickWebhookHandler {
  constructor(
    private readonly publicKey: string,
    private readonly store: ChatStore,
    private readonly broker: ChatEventBroker,
  ) {}

  async handle(headers: Headers, body: string): Promise<NeverthrowResult<void, KickWebhookError>> {
    const publicKey = this.publicKey;
    const store = this.store;
    const broker = this.broker;
    return await safeTry(async function* () {
      const messageId = yield* requiredHeader(headers, "Kick-Event-Message-Id");
      const timestamp = yield* requiredHeader(headers, "Kick-Event-Message-Timestamp");
      const signature = yield* requiredHeader(headers, "Kick-Event-Signature");
      const eventType = yield* requiredHeader(headers, "Kick-Event-Type");
      yield* verifySignature(publicKey, messageId, timestamp, body, signature);

      if (eventType === "chat.message.sent") {
        const message = yield* parseJson(body)
          .andThen((value) => validate(value, KickMessageSchema))
          .mapErr(
            (cause): KickWebhookError => ({
              type: "invalid kick webhook",
              detail: "Kick message payload is invalid",
              cause,
            }),
          );
        const source = await store.getEnabledSourceByProviderId(
          "kick",
          message.broadcaster.user_id,
        );
        if (!source) {
          return erro({ type: "unknown kick source", detail: "Kick source not found" });
        }
        await broker.publish(
          source.userId,
          {
            type: "message",
            message: {
              id: message.message_id,
              sourceId: source.connectedSource.source.sourceId,
              connectionId: source.connectedSource.source.connectionId,
              provider: "kick",
              author: {
                id: message.sender.user_id,
                displayName: message.sender.username,
              },
              text: message.content,
              occurredAt: new Date(message.created_at),
            },
          },
          `kick:${messageId}`,
        );
      }
      return ok(undefined);
    });
  }
}
