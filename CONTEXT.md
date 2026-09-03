# Coldbrew context

The product glossary and invariants live in `AGENTS.md`. This file adds domain language for the
chat integration modules.

## Chat integration

- **chat provider connection** — one OAuth grant from a Coldbrew user to one provider account.
  A user may have multiple connections for the same provider. Credentials belong to the chat
  aggregation module and never cross its external seam.
- **chat source** — one provider-owned channel whose messages are included in a user's multichat.
  Every source belongs to exactly one chat provider connection. Arbitrary public sources are not
  supported.
- **chat capability** — one operation a connection can perform: read, send, delete, timeout, ban,
  or unban. The UI derives available actions from capabilities instead of provider names.
- **broadcast message** — one user command that independently sends the same text to every enabled
  source with the `send_message` capability. Its result contains one outcome per source and is not
  transactional across providers.
- **chat aggregation module** — the separately deployed module that owns provider connections,
  collectors, provider webhooks, normalized events, moderation commands, broadcast messages, and
  the moderation audit. `apps/web` owns the public tRPC interface, Coldbrew authentication, and
  validation at the module's external seam.
