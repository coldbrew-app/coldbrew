-- migrate:up
CREATE TYPE donation_alert_asset_kind AS ENUM ('image', 'sound', 'tts');
CREATE TYPE donation_alert_playback_kind AS ENUM ('incoming', 'replay', 'test');
CREATE TYPE donation_alert_playback_status AS ENUM (
  'preparing',
  'pending',
  'playing',
  'completed',
  'skipped',
  'expired',
  'interrupted'
);

CREATE TABLE donation_alert_asset (
  donation_alert_asset_id uuid                      PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 int                       NOT NULL REFERENCES "user" (user_id)
  ON DELETE CASCADE,
  kind                    donation_alert_asset_kind NOT NULL,
  mime_type               text                      NOT NULL
  CHECK (char_length(mime_type) BETWEEN 1 AND 100),
  content                 bytea                     NOT NULL
  CHECK (octet_length(content) BETWEEN 1 AND 10485760),
  content_hash            char(64)                  NOT NULL
  CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  duration_ms             nonnegative_int               NULL,
  created_at              js_date                   NOT NULL DEFAULT now(),
  UNIQUE (donation_alert_asset_id, user_id),
  UNIQUE (user_id, kind, content_hash)
);

CREATE TABLE donation_alert_configuration (
  user_id             int             PRIMARY KEY REFERENCES "user" (user_id) ON DELETE CASCADE,
  enabled             boolean         NOT NULL DEFAULT FALSE,
  paused              boolean         NOT NULL DEFAULT FALSE,
  display_duration_ms positive_int    NOT NULL DEFAULT 7000
  CHECK (display_duration_ms BETWEEN 1000 AND 30000),
  sound_volume        nonnegative_int NOT NULL DEFAULT 80 CHECK (sound_volume <= 100),
  tts_enabled         boolean         NOT NULL DEFAULT FALSE,
  tts_voice           text            NOT NULL DEFAULT 'ru'
  CHECK (char_length(trim(tts_voice)) BETWEEN 1 AND 64),
  tts_volume          nonnegative_int NOT NULL DEFAULT 80 CHECK (tts_volume <= 100),
  accent_color        char(7)         NOT NULL DEFAULT '#f59e0b'
  CHECK (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  image_asset_id      uuid                NULL,
  sound_asset_id      uuid                NULL,
  updated_at          js_date         NOT NULL DEFAULT now(),
  FOREIGN KEY (image_asset_id, user_id)
  REFERENCES donation_alert_asset (donation_alert_asset_id, user_id),
  FOREIGN KEY (sound_asset_id, user_id)
  REFERENCES donation_alert_asset (donation_alert_asset_id, user_id)
);

CREATE TABLE donation_alert_source (
  user_id int             NOT NULL REFERENCES donation_alert_configuration (user_id) ON DELETE CASCADE,
  source  donation_source NOT NULL,
  enabled boolean         NOT NULL DEFAULT TRUE,
  PRIMARY KEY (user_id, source)
);

CREATE TABLE donation_alert_overlay (
  user_id    int      PRIMARY KEY REFERENCES "user" (user_id) ON DELETE CASCADE,
  token_hash char(64)     NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  updated_at js_date  NOT NULL DEFAULT now()
);

CREATE TABLE donation_alert_player (
  user_id          int     PRIMARY KEY REFERENCES "user" (user_id) ON DELETE CASCADE,
  player_id        uuid    NOT NULL,
  generation       bigint  NOT NULL DEFAULT 0 CHECK (generation >= 0),
  active           boolean NOT NULL DEFAULT FALSE,
  visible          boolean NOT NULL DEFAULT FALSE,
  connected_at     js_date NOT NULL,
  last_seen_at     js_date NOT NULL,
  lease_expires_at js_date NOT NULL
);

CREATE TABLE donation_alert_playback (
  donation_alert_playback_id   uuid                           PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_sequence               bigint                         GENERATED ALWAYS AS IDENTITY UNIQUE,
  user_id                      int                            NOT NULL REFERENCES "user" (user_id)
  ON DELETE CASCADE,
  donation_id                  bigint                             NULL REFERENCES donation (donation_id)
  ON DELETE CASCADE,
  kind                         donation_alert_playback_kind   NOT NULL,
  status                       donation_alert_playback_status NOT NULL,
  source                       donation_source                    NULL,
  author                       text                               NULL
  CHECK (char_length(author) <= 200),
  message                      text                               NULL
  CHECK (char_length(message) <= 2000),
  amount                       money_amount                   NOT NULL,
  currency                     currency_code                  NOT NULL,
  image_asset_id               uuid                               NULL,
  sound_asset_id               uuid                               NULL,
  tts_asset_id                 uuid                               NULL,
  display_duration_ms          positive_int                   NOT NULL
  CHECK (display_duration_ms BETWEEN 1000 AND 30000),
  sound_volume                 nonnegative_int                NOT NULL CHECK (sound_volume <= 100),
  tts_volume                   nonnegative_int                NOT NULL CHECK (tts_volume <= 100),
  tts_voice                    text                           NOT NULL
  CHECK (char_length(trim(tts_voice)) BETWEEN 1 AND 64),
  accent_color                 char(7)                        NOT NULL
  CHECK (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  created_at                   js_date                        NOT NULL,
  available_at                 js_date                        NOT NULL,
  expires_at                   js_date                        NOT NULL,
  started_at                   js_date                            NULL,
  finished_at                  js_date                            NULL,
  player_id                    uuid                               NULL,
  player_generation            bigint                             NULL CHECK (player_generation >= 0),
  preparation_generation       bigint                         NOT NULL DEFAULT 0
  CHECK (preparation_generation >= 0),
  preparation_attempts         nonnegative_int                NOT NULL DEFAULT 0,
  preparation_lease_expires_at js_date                            NULL,
  last_error                   text                               NULL CHECK (char_length(last_error) <= 1000),
  CHECK (
    (kind = 'test' AND donation_id IS NULL) OR
    (kind IN ('incoming', 'replay') AND donation_id IS NOT NULL)
  ),
  CHECK (expires_at > created_at),
  UNIQUE (donation_alert_playback_id, user_id),
  FOREIGN KEY (image_asset_id, user_id)
  REFERENCES donation_alert_asset (donation_alert_asset_id, user_id),
  FOREIGN KEY (sound_asset_id, user_id)
  REFERENCES donation_alert_asset (donation_alert_asset_id, user_id),
  FOREIGN KEY (tts_asset_id, user_id)
  REFERENCES donation_alert_asset (donation_alert_asset_id, user_id)
);

CREATE TABLE donation_alert_renderer_diagnostic (
  donation_alert_playback_id uuid    NOT NULL,
  user_id                    int     NOT NULL,
  code                       text    NOT NULL
  CHECK (code IN ('image_unavailable', 'sound_unavailable', 'tts_unavailable', 'audio_blocked')),
  occurred_at                js_date NOT NULL,
  PRIMARY KEY (donation_alert_playback_id, code),
  FOREIGN KEY (donation_alert_playback_id, user_id)
  REFERENCES donation_alert_playback (donation_alert_playback_id, user_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX donation_alert_playback_incoming_donation_idx
ON donation_alert_playback (donation_id)
WHERE kind = 'incoming';

CREATE UNIQUE INDEX donation_alert_playback_playing_user_idx
ON donation_alert_playback (user_id)
WHERE status = 'playing';

CREATE INDEX donation_alert_playback_pending_idx
ON donation_alert_playback (user_id, available_at, queue_sequence)
WHERE status = 'pending';

CREATE INDEX donation_alert_playback_preparing_idx
ON donation_alert_playback (
  available_at,
  preparation_lease_expires_at,
  queue_sequence
)
WHERE status = 'preparing';

CREATE INDEX donation_alert_playback_expiry_idx
ON donation_alert_playback (expires_at)
WHERE status IN ('preparing', 'pending');

CREATE INDEX donation_alert_playback_recent_idx
ON donation_alert_playback (user_id, queue_sequence DESC);

CREATE INDEX donation_alert_playback_terminal_retention_idx
ON donation_alert_playback (finished_at)
WHERE status IN ('completed', 'skipped', 'expired', 'interrupted');

CREATE INDEX donation_alert_renderer_diagnostic_recent_idx
ON donation_alert_renderer_diagnostic (user_id, occurred_at DESC);

-- migrate:down
DROP TABLE donation_alert_renderer_diagnostic;
DROP TABLE donation_alert_playback;
DROP TABLE donation_alert_player;
DROP TABLE donation_alert_overlay;
DROP TABLE donation_alert_source;
DROP TABLE donation_alert_configuration;
DROP TABLE donation_alert_asset;
DROP TYPE donation_alert_playback_status;
DROP TYPE donation_alert_playback_kind;
DROP TYPE donation_alert_asset_kind;
