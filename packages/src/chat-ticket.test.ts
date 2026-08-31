import { describe, expect, it } from "vitest";

import { createChatTicket, verifyChatTicket } from "./chat-ticket.js";

const secret = "a-secret-that-is-long-enough-for-chat-tickets";

describe("chat ticket", () => {
  it("round-trips its principal and scope", () => {
    const ticket = createChatTicket(secret, 42, "editor", 1_000);

    expect(verifyChatTicket(secret, ticket, 1_001)).toMatchObject({
      value: {
        userId: 42,
        scope: "editor",
        expiresAt: 301_000,
      },
    });
  });

  it("rejects a tampered ticket", () => {
    const ticket = createChatTicket(secret, 42, "editor", 1_000);
    const tampered = `${ticket.slice(0, -1)}x`;

    expect(verifyChatTicket(secret, tampered, 1_001)).toEqual({
      error: { type: "invalid chat ticket" },
    });
  });

  it("rejects an expired ticket", () => {
    const ticket = createChatTicket(secret, 42, "overlay", 1_000);

    expect(verifyChatTicket(secret, ticket, 301_000)).toEqual({
      error: { type: "expired chat ticket" },
    });
  });
});
