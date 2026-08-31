import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { erro } from "@lebedevna/neverthrow-utils";
import { ok, Result } from "neverthrow";
import { z } from "zod";

const ChatTicketPayloadSchema = z.object({
  userId: z.int().positive(),
  scope: z.enum(["editor", "overlay"]),
  expiresAt: z.int().positive(),
  nonce: z.string().min(16),
});

export type ChatTicketScope = z.infer<typeof ChatTicketPayloadSchema>["scope"];
export type ChatTicketPayload = z.infer<typeof ChatTicketPayloadSchema>;

export type ChatTicketError = Readonly<{
  type: "invalid chat ticket" | "expired chat ticket";
}>;

const TICKET_LIFETIME_MS = 5 * 60 * 1_000;

function signature(secret: string, payload: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createChatTicket(
  secret: string,
  userId: number,
  scope: ChatTicketScope,
  now = Date.now(),
) {
  const payload = Buffer.from(
    JSON.stringify({
      userId,
      scope,
      expiresAt: now + TICKET_LIFETIME_MS,
      nonce: randomBytes(18).toString("base64url"),
    }),
  ).toString("base64url");
  return `${payload}.${signature(secret, payload)}`;
}

export function verifyChatTicket(
  secret: string,
  ticket: string,
  now = Date.now(),
): Result<ChatTicketPayload, ChatTicketError> {
  const [payload, receivedSignature, extra] = ticket.split(".");
  if (!payload || !receivedSignature || extra !== undefined) {
    return erro({ type: "invalid chat ticket" });
  }

  const expectedSignature = signature(secret, payload);
  const received = Buffer.from(receivedSignature);
  const expected = Buffer.from(expectedSignature);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return erro({ type: "invalid chat ticket" });
  }

  const parsedPayload = Result.fromThrowable(
    () => ChatTicketPayloadSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString())),
    (): ChatTicketError => ({ type: "invalid chat ticket" }),
  )();
  if (parsedPayload.isErr()) return parsedPayload;
  if (parsedPayload.value.expiresAt <= now) return erro({ type: "expired chat ticket" });

  return ok(parsedPayload.value);
}
