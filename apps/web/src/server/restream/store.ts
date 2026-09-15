import { createHash, randomBytes } from "node:crypto";

import {
  MAX_RESTREAM_DESTINATIONS,
  RestreamConfigSchema,
  RestreamDestinationIdSchema,
  RestreamDestinationSchema,
  RestreamIngestKeySchema,
  RestreamSessionIdSchema,
  RestreamSessionSchema,
  type RestreamConfig,
  type RestreamDestinationId,
  type RestreamDestinationState,
  type RestreamIngestKey,
  type RestreamPlatform,
  type RestreamServerUrl,
} from "@streambrew/packages/restream.js";
import type { UserId } from "@streambrew/packages/schemas.js";
import type { Sql } from "postgres";
import { z } from "zod";

import { CredentialCipher } from "./credential-cipher.js";

export class RestreamDestinationLimitError extends Error {
  constructor() {
    super("Restream destination limit reached.");
  }
}

export class RestreamDestinationNotFoundError extends Error {
  constructor() {
    super("Restream destination not found.");
  }
}

const CiphertextSchema = z.instanceof(Uint8Array);

function createIngestKey() {
  return RestreamIngestKeySchema.parse(`sb_${randomBytes(32).toString("base64url")}`);
}

function hashIngestKey(key: RestreamIngestKey) {
  return createHash("sha256").update(key).digest("hex");
}

function streamKeyHint(streamKey: string) {
  return streamKey.slice(-4);
}

export class RestreamStore {
  constructor(
    private readonly sql: Sql,
    private readonly cipher: CredentialCipher,
    private readonly ingestServerUrl: string,
  ) {}

  async config(userId: UserId): Promise<RestreamConfig> {
    const [ingestRows, destinationRows, sessionRows] = await Promise.all([
      this.sql`
        SELECT stream_key_ciphertext
        FROM restream_ingest
        WHERE user_id = ${userId}
      `,
      this.sql`
        SELECT
          restream_destination_id AS destination_id,
          platform,
          label,
          server_url,
          stream_key_hint,
          enabled,
          "position"
        FROM restream_destination
        WHERE user_id = ${userId}
        ORDER BY "position"
      `,
      this.sql`
        SELECT
          restream_session_id AS session_id,
          status,
          started_at,
          live_at,
          last_heartbeat_at
        FROM restream_session
        WHERE user_id = ${userId}
          AND status <> 'ended'
          AND last_heartbeat_at >= now() - interval '30 seconds'
        ORDER BY started_at DESC
        LIMIT 1
      `,
    ]);
    const ingestSchema = z.object({ streamKeyCiphertext: CiphertextSchema });
    const ingest = ingestSchema.optional().parse(ingestRows[0]);
    const destinations = z.array(RestreamDestinationSchema).parse(destinationRows);
    const sessionRowSchema = RestreamSessionSchema.omit({ destinations: true });
    const sessionRow = sessionRowSchema.optional().parse(sessionRows[0]);
    const session =
      sessionRow === undefined
        ? null
        : {
            ...sessionRow,
            destinations: await this.sessionDestinations(sessionRow.sessionId),
          };

    return RestreamConfigSchema.parse({
      ingest:
        ingest === undefined
          ? null
          : {
              serverUrl: this.ingestServerUrl,
              streamKey: this.cipher.decrypt(ingest.streamKeyCiphertext),
            },
      destinations,
      session,
      plan: {
        status: "beta",
        monthlyPriceUsdCents: 1999,
        maxDestinations: MAX_RESTREAM_DESTINATIONS,
      },
    });
  }

  private async sessionDestinations(sessionId: string) {
    const rows = await this.sql`
      SELECT
        restream_destination_id AS destination_id,
        state,
        outbound_bytes
      FROM restream_session_destination
      WHERE restream_session_id = ${sessionId}
      ORDER BY restream_destination_id
    `;
    const schema = z.object({
      destinationId: RestreamDestinationIdSchema,
      state: z.enum(["idle", "forwarding", "error"]),
      outboundBytes: z.coerce.number().int().nonnegative(),
    });
    return z.array(schema).parse(rows);
  }

  async rotateIngestKey(userId: UserId) {
    const key = createIngestKey();
    await this.sql`
      INSERT INTO restream_ingest (
        user_id,
        stream_key_hash,
        stream_key_ciphertext,
        updated_at
      )
      VALUES (
        ${userId},
        ${hashIngestKey(key)},
        ${this.cipher.encrypt(key)},
        now()
      )
      ON CONFLICT (user_id) DO UPDATE
      SET
        stream_key_hash = EXCLUDED.stream_key_hash,
        stream_key_ciphertext = EXCLUDED.stream_key_ciphertext,
        updated_at = now()
    `;
    return key;
  }

  async createDestination(
    userId: UserId,
    input: {
      platform: RestreamPlatform;
      label: string;
      serverUrl: RestreamServerUrl;
      streamKey: string;
    },
  ) {
    return await this.sql.begin(async (sql) => {
      await sql`SELECT user_id FROM "user" WHERE user_id = ${userId} FOR UPDATE`;
      const countRows = await sql`
        SELECT count(*)::int AS count
        FROM restream_destination
        WHERE user_id = ${userId}
      `;
      const countSchema = z.object({ count: z.int().nonnegative() });
      const count = countSchema.parse(countRows[0]).count;
      if (count >= MAX_RESTREAM_DESTINATIONS) throw new RestreamDestinationLimitError();
      const rows = await sql`
        INSERT INTO restream_destination (
          user_id,
          platform,
          label,
          server_url,
          stream_key_ciphertext,
          stream_key_hint,
          "position"
        )
        VALUES (
          ${userId},
          ${input.platform},
          ${input.label},
          ${input.serverUrl},
          ${this.cipher.encrypt(input.streamKey)},
          ${streamKeyHint(input.streamKey)},
          ${count}
        )
        RETURNING restream_destination_id AS destination_id
      `;
      const schema = z.object({ destinationId: RestreamDestinationIdSchema });
      return schema.parse(rows[0]).destinationId;
    });
  }

  async updateDestination(
    userId: UserId,
    destinationId: RestreamDestinationId,
    input: {
      platform: RestreamPlatform;
      label: string;
      serverUrl: RestreamServerUrl;
      streamKey?: string;
    },
  ) {
    const rows =
      input.streamKey === undefined
        ? await this.sql`
            UPDATE restream_destination
            SET
              platform = ${input.platform},
              label = ${input.label},
              server_url = ${input.serverUrl},
              updated_at = now()
            WHERE restream_destination_id = ${destinationId}
              AND user_id = ${userId}
            RETURNING restream_destination_id
          `
        : await this.sql`
            UPDATE restream_destination
            SET
              platform = ${input.platform},
              label = ${input.label},
              server_url = ${input.serverUrl},
              stream_key_ciphertext = ${this.cipher.encrypt(input.streamKey)},
              stream_key_hint = ${streamKeyHint(input.streamKey)},
              updated_at = now()
            WHERE restream_destination_id = ${destinationId}
              AND user_id = ${userId}
            RETURNING restream_destination_id
          `;
    if (rows.length === 0) throw new RestreamDestinationNotFoundError();
  }

  async setDestinationEnabled(
    userId: UserId,
    destinationId: RestreamDestinationId,
    enabled: boolean,
  ) {
    const rows = await this.sql`
      UPDATE restream_destination
      SET enabled = ${enabled}, updated_at = now()
      WHERE restream_destination_id = ${destinationId}
        AND user_id = ${userId}
      RETURNING restream_destination_id
    `;
    if (rows.length === 0) throw new RestreamDestinationNotFoundError();
  }

  async deleteDestination(userId: UserId, destinationId: RestreamDestinationId) {
    await this.sql.begin(async (sql) => {
      await sql`SELECT user_id FROM "user" WHERE user_id = ${userId} FOR UPDATE`;
      const rows = await sql`
        DELETE FROM restream_destination
        WHERE restream_destination_id = ${destinationId}
          AND user_id = ${userId}
        RETURNING restream_destination_id
      `;
      if (rows.length === 0) throw new RestreamDestinationNotFoundError();
      await sql`
        UPDATE restream_destination
        SET "position" = "position" + ${MAX_RESTREAM_DESTINATIONS}
        WHERE user_id = ${userId}
      `;
      await sql`
        WITH ordered AS (
          SELECT
            restream_destination_id,
            row_number() OVER (ORDER BY "position") - 1 AS new_position
          FROM restream_destination
          WHERE user_id = ${userId}
        )
        UPDATE restream_destination
        SET "position" = ordered.new_position
        FROM ordered
        WHERE restream_destination.restream_destination_id = ordered.restream_destination_id
      `;
    });
  }

  async authorizePublisher(nodeId: string, publisherId: string, key: RestreamIngestKey) {
    return await this.sql.begin(async (sql) => {
      const ingestRows = await sql`
        SELECT user_id
        FROM restream_ingest
        WHERE stream_key_hash = ${hashIngestKey(key)}
        FOR UPDATE
      `;
      const ingestSchema = z.object({ userId: z.int().positive() });
      const ingest = ingestSchema.optional().parse(ingestRows[0]);
      if (ingest === undefined) return null;

      const destinationRows = await sql`
        SELECT
          restream_destination_id AS destination_id,
          server_url,
          stream_key_ciphertext
        FROM restream_destination
        WHERE user_id = ${ingest.userId}
          AND enabled
        ORDER BY "position"
      `;
      const destinationSchema = z.object({
        destinationId: RestreamDestinationIdSchema,
        serverUrl: z.string(),
        streamKeyCiphertext: CiphertextSchema,
      });
      const destinations = z.array(destinationSchema).parse(destinationRows);
      if (destinations.length === 0) return null;

      await sql`
        UPDATE restream_session
        SET status = 'ended', ended_at = now(), last_heartbeat_at = now()
        WHERE user_id = ${ingest.userId}
          AND status <> 'ended'
      `;
      const sessionRows = await sql`
        INSERT INTO restream_session (user_id, node_id, publisher_id)
        VALUES (${ingest.userId}, ${nodeId}, ${publisherId})
        RETURNING restream_session_id AS session_id
      `;
      const sessionSchema = z.object({ sessionId: RestreamSessionIdSchema });
      const { sessionId } = sessionSchema.parse(sessionRows[0]);
      for (const destination of destinations) {
        await sql`
          INSERT INTO restream_session_destination (
            restream_session_id,
            restream_destination_id,
            user_id
          )
          VALUES (${sessionId}, ${destination.destinationId}, ${ingest.userId})
        `;
      }
      return {
        sessionId,
        destinations: destinations.map((destination) => ({
          destinationId: destination.destinationId,
          targetUrl: `${destination.serverUrl}#${this.cipher.decrypt(destination.streamKeyCiphertext)}`,
        })),
      };
    });
  }

  async heartbeat(
    nodeId: string,
    sessionId: string,
    destinations: readonly {
      destinationId: RestreamDestinationId;
      state: RestreamDestinationState;
      outboundBytes: number;
    }[],
  ) {
    return await this.sql.begin(async (sql) => {
      const rows = await sql`
        UPDATE restream_session
        SET
          status = 'live',
          live_at = coalesce(live_at, now()),
          last_heartbeat_at = now()
        WHERE restream_session_id = ${sessionId}
          AND node_id = ${nodeId}
          AND status <> 'ended'
        RETURNING restream_session_id
      `;
      if (rows.length === 0) return false;
      for (const destination of destinations) {
        await sql`
          UPDATE restream_session_destination
          SET
            state = ${destination.state},
            outbound_bytes = greatest(outbound_bytes, ${destination.outboundBytes}),
            updated_at = now()
          WHERE restream_session_id = ${sessionId}
            AND restream_destination_id = ${destination.destinationId}
        `;
      }
      return true;
    });
  }

  async endSession(nodeId: string, sessionId: string) {
    const rows = await this.sql`
      UPDATE restream_session
      SET status = 'ended', ended_at = now(), last_heartbeat_at = now()
      WHERE restream_session_id = ${sessionId}
        AND node_id = ${nodeId}
        AND status <> 'ended'
      RETURNING restream_session_id
    `;
    return rows.length > 0;
  }
}
