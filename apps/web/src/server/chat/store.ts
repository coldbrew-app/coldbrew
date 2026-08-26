import { rurl } from "@lebedevna/readonly-url";
import type { ChatSource } from "@web/lib/chat.js";
import { ChatSourceSchema } from "@web/lib/chat.js";
import { z } from "zod";

import { env } from "../env.js";
import { sql } from "../sensors/db/index.js";
import { createOverlayToken, hashOverlayToken } from "./token.js";

const SourceRowsSchema = z.array(
  ChatSourceSchema.extend({
    position: z.number().int().nonnegative(),
  }),
);

async function ensureOverlay(userId: number) {
  await sql`
    INSERT INTO chat_overlay (user_id)
    VALUES (${userId})
    ON CONFLICT (user_id) DO NOTHING
  `;
}

export async function getChatConfig(userId: number) {
  await ensureOverlay(userId);
  const rows = await sql`
    SELECT provider, source_identifier, source_url, position
    FROM chat_overlay_source
    WHERE user_id = ${userId}
    ORDER BY position
  `;
  const tokenRows = await sql`
    SELECT token_hash IS NOT NULL AS has_overlay_token
    FROM chat_overlay
    WHERE user_id = ${userId}
  `;
  const schema = z.object({
    hasOverlayToken: z.boolean(),
  });

  return {
    hasOverlayToken: schema.parse(tokenRows[0]).hasOverlayToken,
    sources: SourceRowsSchema.parse(rows).map(({ position: _position, ...source }) => source),
  };
}

export async function updateChatSources(userId: number, sources: readonly ChatSource[]) {
  await sql.begin(async (transaction) => {
    await transaction`
      INSERT INTO chat_overlay (user_id)
      VALUES (${userId})
      ON CONFLICT (user_id) DO NOTHING
    `;
    await transaction`
      DELETE FROM chat_overlay_source
      WHERE user_id = ${userId}
    `;
    for (const [position, source] of sources.entries()) {
      await transaction`
        INSERT INTO chat_overlay_source (
          user_id, provider, source_identifier, source_url, position
        )
        VALUES (
          ${userId},
          ${source.provider},
          ${source.sourceIdentifier},
          ${source.sourceUrl},
          ${position}
        )
      `;
    }
  });
  return await getChatConfig(userId);
}

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

export async function getSourcesByOverlayToken(token: string) {
  const tokenHash = hashOverlayToken(token);
  const overlayRows = await sql`
    SELECT user_id
    FROM chat_overlay
    WHERE token_hash = ${tokenHash}
  `;
  const schema = z.object({
    userId: z.number().int().positive(),
  });
  const userId = schema.optional().parse(overlayRows[0])?.userId;
  if (userId === undefined) return null;
  const rows = await sql`
    SELECT source.provider, source.source_identifier, source.source_url, source.position
    FROM chat_overlay
    JOIN chat_overlay_source AS source USING (user_id)
    WHERE chat_overlay.user_id = ${userId}
    ORDER BY source.position
  `;
  return {
    sources: SourceRowsSchema.parse(rows).map(({ position: _position, ...source }) => source),
    userId,
  };
}

export async function getChatSources(userId: number) {
  return (await getChatConfig(userId)).sources;
}
