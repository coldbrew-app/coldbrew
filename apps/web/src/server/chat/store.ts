import { rurl } from "@lebedevna/readonly-url";
import { z } from "zod";

import { env } from "../env.js";
import { sql } from "../sensors/db/index.js";
import { createOverlayToken, hashOverlayToken } from "./token.js";

export async function rotateOverlayToken(userId: number) {
  const token = createOverlayToken();
  const tokenHash = hashOverlayToken(token);
  await sql`
    INSERT INTO chat_overlay (user_id, token_hash, updated_at)
    VALUES (${userId}, ${tokenHash}, now())
    ON CONFLICT (user_id) DO UPDATE
    SET token_hash = EXCLUDED.token_hash, updated_at = now()
  `;
  return {
    token,
    overlayUrl: rurl(`/chat/overlay/${token}`, env.APP_DOMAIN).href,
  };
}

export async function getUserIdByOverlayToken(token: string) {
  const tokenHash = hashOverlayToken(token);
  const rows = await sql`
    SELECT user_id
    FROM chat_overlay
    WHERE token_hash = ${tokenHash}
  `;
  return z.object({ userId: z.int().positive() }).optional().parse(rows[0])?.userId ?? null;
}
