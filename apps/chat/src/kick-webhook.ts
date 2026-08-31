import { createVerify } from "node:crypto";

import { erro, parseJson, validate } from "@lebedevna/neverthrow-utils";
import { ok, Result, type Result as NeverthrowResult } from "neverthrow";
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
  return value
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
    const $messageId = requiredHeader(headers, "Kick-Event-Message-Id");
    if ($messageId.isErr()) return $messageId;
    const $timestamp = requiredHeader(headers, "Kick-Event-Message-Timestamp");
    if ($timestamp.isErr()) return $timestamp;
    const $signature = requiredHeader(headers, "Kick-Event-Signature");
    if ($signature.isErr()) return $signature;
    const $eventType = requiredHeader(headers, "Kick-Event-Type");
    if ($eventType.isErr()) return $eventType;
    const $signatureValid = verifySignature(
      this.publicKey,
      $messageId.value,
      $timestamp.value,
      body,
      $signature.value,
    );
    if ($signatureValid.isErr()) return $signatureValid;

    if ($eventType.value === "chat.message.sent") {
      const $message = parseJson(body).andThen((value) => validate(value, KickMessageSchema));
      if ($message.isErr()) {
        return erro({
          type: "invalid kick webhook",
          detail: "Kick message payload is invalid",
          cause: $message.error,
        });
      }
      const source = await this.store.getEnabledSourceByProviderId(
        "kick",
        $message.value.broadcaster.user_id,
      );
      if (!source) return erro({ type: "unknown kick source", detail: "Kick source not found" });
      await this.broker.publish(
        source.userId,
        {
          type: "message",
          message: {
            id: $message.value.message_id,
            sourceId: source.connectedSource.source.sourceId,
            connectionId: source.connectedSource.source.connectionId,
            provider: "kick",
            author: {
              id: $message.value.sender.user_id,
              displayName: $message.value.sender.username,
            },
            text: $message.value.content,
            occurredAt: new Date($message.value.created_at),
          },
        },
        `kick:${$messageId.value}`,
      );
      return ok(undefined);
    }

    return ok(undefined);
  }
}
