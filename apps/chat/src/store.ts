import type {
  ChatCapability,
  ChatConfig,
  ChatProvider,
  ChatProviderConnection,
  ChatProviderConnectionId,
  ChatSourceId,
} from "@coldbrew/packages/chat.js";
import {
  ChatProviderConnectionIdSchema,
  ChatProviderConnectionSchema,
  ChatProviderSchema,
  ChatSourceIdSchema,
  ChatSourceSchema,
  MAX_CHAT_SOURCES,
} from "@coldbrew/packages/chat.js";
import type { Sql, TransactionSql } from "postgres";
import { z } from "zod";

import type { ChatAuditEntry, ChatRepository } from "./chat-application.js";
import type { ConnectedChatSource } from "./provider.js";
import { TokenCipher } from "./token-cipher.js";

type SaveConnection = Readonly<{
  provider: ChatProvider;
  providerUserId: string;
  displayName: string;
  accessToken?: string;
  refreshToken?: string;
  accessTokenExpiresAt?: Date;
  scopes: readonly string[];
}>;

type SaveSource = Readonly<{
  provider: ChatProvider;
  providerSourceId: string;
  displayName: string;
  sourceUrl: string;
}>;

type QuerySql = Sql | TransactionSql;

export type ChatOauthAttempt = Readonly<{
  userId: number;
  provider: ChatProvider;
  verifier: string;
  returnUrl: string;
}>;

function capabilitiesFor(provider: ChatProvider, scopes: readonly string[]): ChatCapability[] {
  const granted = new Set(scopes);
  if (provider === "boosty" || provider === "vk_video") return ["read"];
  if (provider === "youtube") {
    return granted.has("https://www.googleapis.com/auth/youtube.force-ssl")
      ? ["read", "send_message", "delete_message", "timeout_user", "ban_user", "unban_user"]
      : ["read"];
  }
  if (provider === "twitch") {
    return [
      ...(granted.has("user:read:chat") ? (["read"] as const) : []),
      ...(granted.has("user:write:chat") ? (["send_message"] as const) : []),
      ...(granted.has("moderator:manage:chat_messages") ? (["delete_message"] as const) : []),
      ...(granted.has("moderator:manage:banned_users")
        ? (["timeout_user", "ban_user", "unban_user"] as const)
        : []),
    ];
  }
  return [
    ...(granted.has("events:subscribe") ? (["read"] as const) : []),
    ...(granted.has("chat:write") ? (["send_message"] as const) : []),
    ...(granted.has("moderation:chat_message:manage") ? (["delete_message"] as const) : []),
    ...(granted.has("moderation:ban") ? (["timeout_user", "ban_user", "unban_user"] as const) : []),
  ];
}

const ConnectedSourceRowSchema = ChatSourceSchema.extend({
  accessTokenCiphertext: z.instanceof(Buffer).nullable(),
  refreshTokenCiphertext: z.instanceof(Buffer).nullable(),
  accessTokenExpiresAt: z.date().nullable(),
  scopes: z.array(z.string()),
  tokenVersion: z.int().positive(),
});

const OwnedConnectedSourceRowSchema = ConnectedSourceRowSchema.extend({
  userId: z.int().positive(),
});

function connectedSourceFromRow(
  row: z.infer<typeof ConnectedSourceRowSchema>,
  tokenCipher: TokenCipher,
): ConnectedChatSource {
  const accessToken = row.accessTokenCiphertext
    ? tokenCipher.decrypt(row.accessTokenCiphertext)._unsafeUnwrap()
    : undefined;
  const refreshToken = row.refreshTokenCiphertext
    ? tokenCipher.decrypt(row.refreshTokenCiphertext)._unsafeUnwrap()
    : undefined;
  const {
    accessTokenCiphertext: _accessTokenCiphertext,
    refreshTokenCiphertext: _refreshTokenCiphertext,
    accessTokenExpiresAt,
    scopes,
    tokenVersion,
    ...source
  } = row;
  return {
    source,
    capabilities: capabilitiesFor(source.provider, scopes),
    credentials: {
      ...(accessToken ? { accessToken } : {}),
      ...(refreshToken ? { refreshToken } : {}),
      ...(accessTokenExpiresAt ? { expiresAt: accessTokenExpiresAt } : {}),
      scopes,
      tokenVersion,
    },
  };
}

export class ChatStore implements ChatRepository {
  constructor(
    private readonly sql: Sql,
    private readonly tokenCipher: TokenCipher,
  ) {}

  async getConfig(userId: number): Promise<ChatConfig> {
    const [connectionRows, sourceRows, overlayRows] = await Promise.all([
      this.sql`
        SELECT
          chat_provider_connection_id AS connection_id,
          provider,
          provider_user_id,
          display_name,
          status,
          scopes,
          connected_at
        FROM chat_provider_connection
        WHERE user_id = ${userId}
        ORDER BY connected_at, chat_provider_connection_id
      `,
      this.sql`
        SELECT
          chat_source_id AS source_id,
          chat_provider_connection_id AS connection_id,
          provider,
          provider_source_id,
          display_name,
          source_url,
          position,
          enabled
        FROM chat_source
        WHERE user_id = ${userId}
        ORDER BY position
      `,
      this.sql`
        SELECT token_hash IS NOT NULL AS has_overlay_token
        FROM chat_overlay
        WHERE user_id = ${userId}
      `,
    ]);

    const connectionSchema = ChatProviderConnectionSchema.omit({ capabilities: true }).extend({
      scopes: z.array(z.string()),
    });
    const overlaySchema = z.object({
      hasOverlayToken: z.boolean(),
    });
    const connections: ChatProviderConnection[] = z
      .array(connectionSchema)
      .parse(connectionRows)
      .map(({ scopes, ...connection }) => ({
        ...connection,
        capabilities: capabilitiesFor(connection.provider, scopes),
      }));

    return {
      connections,
      sources: z.array(ChatSourceSchema).parse(sourceRows),
      hasOverlayToken: overlaySchema.optional().parse(overlayRows[0])?.hasOverlayToken ?? false,
    };
  }

  async getEnabledSources(userId: number) {
    return await this.loadConnectedSources(userId);
  }

  async getSource(userId: number, sourceId: ChatSourceId) {
    const sources = await this.loadConnectedSources(userId, sourceId);
    return sources[0] ?? null;
  }

  private async loadConnectedSources(userId: number, sourceId?: ChatSourceId) {
    const rows = await this.sql`
      SELECT
        source.chat_source_id AS source_id,
        source.chat_provider_connection_id AS connection_id,
        source.provider,
        source.provider_source_id,
        source.display_name,
        source.source_url,
        source.position,
        source.enabled,
        connection.access_token_ciphertext,
        connection.refresh_token_ciphertext,
        connection.access_token_expires_at,
        connection.scopes,
        connection.token_version
      FROM chat_source AS source
      JOIN chat_provider_connection AS connection
        ON connection.chat_provider_connection_id = source.chat_provider_connection_id
        AND connection.user_id = source.user_id
      WHERE source.user_id = ${userId}
        AND source.enabled
        AND connection.status = 'connected'
        ${sourceId ? this.sql`AND source.chat_source_id = ${sourceId}` : this.sql``}
      ORDER BY source.position
    `;

    return z
      .array(ConnectedSourceRowSchema)
      .parse(rows)
      .map((row) => connectedSourceFromRow(row, this.tokenCipher));
  }

  async getAllEnabledSources() {
    const rows = await this.sql`
      SELECT
        source.user_id,
        source.chat_source_id AS source_id,
        source.chat_provider_connection_id AS connection_id,
        source.provider,
        source.provider_source_id,
        source.display_name,
        source.source_url,
        source.position,
        source.enabled,
        connection.access_token_ciphertext,
        connection.refresh_token_ciphertext,
        connection.access_token_expires_at,
        connection.scopes,
        connection.token_version
      FROM chat_source AS source
      JOIN chat_provider_connection AS connection
        ON connection.chat_provider_connection_id = source.chat_provider_connection_id
        AND connection.user_id = source.user_id
      WHERE source.enabled
        AND connection.status = 'connected'
      ORDER BY source.user_id, source.position
    `;
    return z
      .array(OwnedConnectedSourceRowSchema)
      .parse(rows)
      .map((row) => {
        const { userId, ...sourceRow } = row;
        return {
          userId,
          connectedSource: connectedSourceFromRow(sourceRow, this.tokenCipher),
        };
      });
  }

  async getEnabledSourceByProviderId(provider: ChatProvider, providerSourceId: string) {
    const rows = await this.sql`
      SELECT
        source.user_id,
        source.chat_source_id AS source_id,
        source.chat_provider_connection_id AS connection_id,
        source.provider,
        source.provider_source_id,
        source.display_name,
        source.source_url,
        source.position,
        source.enabled,
        connection.access_token_ciphertext,
        connection.refresh_token_ciphertext,
        connection.access_token_expires_at,
        connection.scopes,
        connection.token_version
      FROM chat_source AS source
      JOIN chat_provider_connection AS connection
        ON connection.chat_provider_connection_id = source.chat_provider_connection_id
        AND connection.user_id = source.user_id
      WHERE source.provider = ${provider}
        AND source.provider_source_id = ${providerSourceId}
        AND source.enabled
        AND connection.status = 'connected'
      LIMIT 1
    `;
    const row = OwnedConnectedSourceRowSchema.optional().parse(rows[0]);
    if (!row) return null;
    const { userId, ...sourceRow } = row;
    return {
      userId,
      connectedSource: connectedSourceFromRow(sourceRow, this.tokenCipher),
    };
  }

  async hasSourceCapacity(userId: number, provider: ChatProvider, providerSourceId: string) {
    const rows = await this.sql`
      SELECT
        EXISTS (
          SELECT 1
          FROM chat_source
          WHERE user_id = ${userId}
            AND provider = ${provider}
            AND provider_source_id = ${providerSourceId}
        ) OR count(*) < ${MAX_CHAT_SOURCES} AS has_capacity
      FROM chat_source
      WHERE user_id = ${userId}
    `;
    return z.object({ hasCapacity: z.boolean() }).parse(rows[0]).hasCapacity;
  }

  private async saveConnection(sql: QuerySql, userId: number, connection: SaveConnection) {
    const rows = await sql`
      INSERT INTO chat_provider_connection (
        user_id,
        provider,
        provider_user_id,
        display_name,
        access_token_ciphertext,
        refresh_token_ciphertext,
        access_token_expires_at,
        scopes
      )
      VALUES (
        ${userId},
        ${connection.provider},
        ${connection.providerUserId},
        ${connection.displayName},
        ${connection.accessToken ? this.tokenCipher.encrypt(connection.accessToken) : null},
        ${connection.refreshToken ? this.tokenCipher.encrypt(connection.refreshToken) : null},
        ${connection.accessTokenExpiresAt ?? null},
        ${sql.array([...connection.scopes])}
      )
      ON CONFLICT (provider, provider_user_id) DO UPDATE
      SET
        display_name = EXCLUDED.display_name,
        access_token_ciphertext = EXCLUDED.access_token_ciphertext,
        refresh_token_ciphertext = COALESCE(
          EXCLUDED.refresh_token_ciphertext,
          chat_provider_connection.refresh_token_ciphertext
        ),
        access_token_expires_at = EXCLUDED.access_token_expires_at,
        scopes = EXCLUDED.scopes,
        status = 'connected',
        token_version = chat_provider_connection.token_version + 1,
        updated_at = now()
      WHERE chat_provider_connection.user_id = EXCLUDED.user_id
      RETURNING chat_provider_connection_id AS connection_id
    `;
    const schema = z.object({
      connectionId: ChatProviderConnectionIdSchema,
    });
    return schema.parse(rows[0]).connectionId;
  }

  async updateConnectionCredentials(
    connectionId: ChatProviderConnectionId,
    expectedTokenVersion: number,
    credentials: Readonly<{
      accessToken: string;
      refreshToken?: string;
      accessTokenExpiresAt?: Date;
    }>,
  ) {
    const rows = await this.sql`
      UPDATE chat_provider_connection
      SET
        access_token_ciphertext = ${this.tokenCipher.encrypt(credentials.accessToken)},
        refresh_token_ciphertext = COALESCE(
          ${credentials.refreshToken ? this.tokenCipher.encrypt(credentials.refreshToken) : null},
          refresh_token_ciphertext
        ),
        access_token_expires_at = ${credentials.accessTokenExpiresAt ?? null},
        token_version = token_version + 1,
        status = 'connected',
        updated_at = now()
      WHERE chat_provider_connection_id = ${connectionId}
        AND token_version = ${expectedTokenVersion}
      RETURNING token_version
    `;
    return (
      z.object({ tokenVersion: z.int().positive() }).optional().parse(rows[0])?.tokenVersion ?? null
    );
  }

  async createOauthAttempt(
    stateHash: string,
    userId: number,
    provider: ChatProvider,
    verifier: string,
    returnUrl: string,
    expiresAt: Date,
  ) {
    await this.sql`
      DELETE FROM chat_oauth_attempt
      WHERE expires_at <= now()
    `;
    await this.sql`
      INSERT INTO chat_oauth_attempt (
        state_hash,
        user_id,
        provider,
        pkce_verifier_ciphertext,
        return_url,
        expires_at
      )
      VALUES (
        ${stateHash},
        ${userId},
        ${provider},
        ${this.tokenCipher.encrypt(verifier)},
        ${returnUrl},
        ${expiresAt}
      )
    `;
  }

  async consumeOauthAttempt(
    stateHash: string,
    provider: ChatProvider,
  ): Promise<ChatOauthAttempt | null> {
    const rows = await this.sql`
      DELETE FROM chat_oauth_attempt
      WHERE state_hash = ${stateHash}
        AND provider = ${provider}
        AND expires_at > now()
      RETURNING
        user_id,
        provider,
        pkce_verifier_ciphertext,
        return_url
    `;
    const schema = z.object({
      userId: z.int().positive(),
      provider: ChatProviderSchema,
      pkceVerifierCiphertext: z.instanceof(Buffer),
      returnUrl: z.url(),
    });
    const row = schema.optional().parse(rows[0]);
    if (!row) return null;
    return {
      userId: row.userId,
      provider: row.provider,
      verifier: this.tokenCipher.decrypt(row.pkceVerifierCiphertext)._unsafeUnwrap(),
      returnUrl: row.returnUrl,
    };
  }

  private async saveSource(
    sql: QuerySql,
    userId: number,
    connectionId: ChatProviderConnectionId,
    source: SaveSource,
  ) {
    const rows = await sql`
      INSERT INTO chat_source (
        chat_provider_connection_id,
        user_id,
        provider,
        provider_source_id,
        display_name,
        source_url,
        position
      )
      VALUES (
        ${connectionId},
        ${userId},
        ${source.provider},
        ${source.providerSourceId},
        ${source.displayName},
        ${source.sourceUrl},
        (
          SELECT COALESCE(max(position) + 1, 0)
          FROM chat_source
          WHERE user_id = ${userId}
        )
      )
      ON CONFLICT (user_id, provider, provider_source_id) DO UPDATE
      SET
        chat_provider_connection_id = EXCLUDED.chat_provider_connection_id,
        display_name = EXCLUDED.display_name,
        source_url = EXCLUDED.source_url,
        enabled = true,
        updated_at = now()
      RETURNING chat_source_id AS source_id
    `;
    const schema = z.object({
      sourceId: ChatSourceIdSchema,
    });
    return schema.parse(rows[0]).sourceId;
  }

  async saveProviderAccount(userId: number, connection: SaveConnection, source: SaveSource) {
    return await this.sql.begin(async (sql) => {
      const connectionId = await this.saveConnection(sql, userId, connection);
      await this.saveSource(sql, userId, connectionId, source);
      return connectionId;
    });
  }

  async disconnect(userId: number, connectionId: ChatProviderConnectionId) {
    await this.sql`
      DELETE FROM chat_provider_connection
      WHERE user_id = ${userId}
        AND chat_provider_connection_id = ${connectionId}
    `;
  }

  async getProviderBanId(sourceId: ChatSourceId, providerUserId: string) {
    const rows = await this.sql`
      SELECT provider_ban_id
      FROM chat_provider_ban
      WHERE chat_source_id = ${sourceId}
        AND provider_user_id = ${providerUserId}
    `;
    const schema = z.object({
      providerBanId: z.string(),
    });
    return schema.optional().parse(rows[0])?.providerBanId ?? null;
  }

  async saveProviderBanId(sourceId: ChatSourceId, providerUserId: string, providerBanId: string) {
    await this.sql`
      INSERT INTO chat_provider_ban (chat_source_id, provider_user_id, provider_ban_id)
      VALUES (${sourceId}, ${providerUserId}, ${providerBanId})
      ON CONFLICT (chat_source_id, provider_user_id) DO UPDATE
      SET
        provider_ban_id = EXCLUDED.provider_ban_id,
        updated_at = now()
    `;
  }

  async deleteProviderBanId(sourceId: ChatSourceId, providerUserId: string) {
    await this.sql`
      DELETE FROM chat_provider_ban
      WHERE chat_source_id = ${sourceId}
        AND provider_user_id = ${providerUserId}
    `;
  }

  async recordAction(entry: ChatAuditEntry) {
    await this.sql`
      INSERT INTO chat_moderation_action (
        user_id,
        chat_source_id,
        provider,
        action_type,
        status,
        provider_message_id,
        provider_user_id,
        duration_seconds,
        reason,
        detail
      )
      VALUES (
        ${entry.userId},
        ${entry.sourceId},
        ${entry.provider},
        ${entry.actionType},
        ${entry.status},
        ${entry.providerMessageId ?? null},
        ${entry.providerUserId ?? null},
        ${entry.durationSeconds ?? null},
        ${entry.reason ?? null},
        ${entry.detail ?? null}
      )
    `;
  }
}
