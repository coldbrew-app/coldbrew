-- migrate:up
CREATE TYPE restream_destination_platform AS ENUM ('twitch', 'youtube', 'kick', 'custom');
CREATE TYPE restream_destination_state AS ENUM ('idle', 'forwarding', 'error');
CREATE TYPE restream_session_status AS ENUM ('connecting', 'live', 'ended');

CREATE TABLE restream_ingest (
  user_id               int      PRIMARY KEY REFERENCES "user" (user_id) ON DELETE CASCADE,
  stream_key_hash       char(64) NOT NULL UNIQUE CHECK (stream_key_hash ~ '^[0-9a-f]{64}$'),
  stream_key_ciphertext bytea    NOT NULL
  CHECK (octet_length(stream_key_ciphertext) BETWEEN 30 AND 2048),
  created_at            js_date  NOT NULL DEFAULT now(),
  updated_at            js_date  NOT NULL DEFAULT now()
);

CREATE TABLE restream_destination (
  restream_destination_id uuid                          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 int                           NOT NULL REFERENCES "user" (user_id)
  ON DELETE CASCADE,
  platform                restream_destination_platform NOT NULL,
  label                   text                          NOT NULL
  CHECK (char_length(trim(label)) BETWEEN 1 AND 64),
  server_url              text                          NOT NULL
  CHECK (
    char_length(server_url) BETWEEN 10 AND 2048
    AND server_url ~ '^rtmps?://'
    AND strpos(server_url, '#') = 0
  ),
  stream_key_ciphertext   bytea                         NOT NULL
  CHECK (octet_length(stream_key_ciphertext) BETWEEN 30 AND 2048),
  stream_key_hint         text                          NOT NULL
  CHECK (char_length(stream_key_hint) BETWEEN 1 AND 8),
  enabled                 boolean                       NOT NULL DEFAULT TRUE,
  "position"              nonnegative_int               NOT NULL CHECK ("position" < 3),
  created_at              js_date                       NOT NULL DEFAULT now(),
  updated_at              js_date                       NOT NULL DEFAULT now(),
  UNIQUE (restream_destination_id, user_id),
  UNIQUE (user_id, "position")
);

CREATE TABLE restream_session (
  restream_session_id uuid                    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             int                     NOT NULL REFERENCES "user" (user_id) ON DELETE CASCADE,
  node_id             text                    NOT NULL CHECK (char_length(node_id) BETWEEN 1 AND 64),
  publisher_id        text                    NOT NULL CHECK (char_length(publisher_id) BETWEEN 1 AND 128),
  status              restream_session_status NOT NULL DEFAULT 'connecting',
  started_at          js_date                 NOT NULL DEFAULT now(),
  live_at             js_date                     NULL,
  last_heartbeat_at   js_date                 NOT NULL DEFAULT now(),
  ended_at            js_date                     NULL,
  CHECK (
    (status = 'connecting' AND live_at IS NULL AND ended_at IS NULL)
    OR (status = 'live' AND live_at IS NOT NULL AND ended_at IS NULL)
    OR (status = 'ended' AND ended_at IS NOT NULL)
  ),
  UNIQUE (restream_session_id, user_id)
);

CREATE UNIQUE INDEX restream_session_active_user_idx
ON restream_session (user_id)
WHERE status <> 'ended';

CREATE UNIQUE INDEX restream_session_active_publisher_idx
ON restream_session (node_id, publisher_id)
WHERE status <> 'ended';

CREATE INDEX restream_session_recent_user_idx
ON restream_session (user_id, started_at DESC);

CREATE TABLE restream_session_destination (
  restream_session_id     uuid                       NOT NULL,
  restream_destination_id uuid                       NOT NULL,
  user_id                 int                        NOT NULL,
  state                   restream_destination_state NOT NULL DEFAULT 'idle',
  outbound_bytes          bigint                     NOT NULL DEFAULT 0 CHECK (outbound_bytes >= 0),
  updated_at              js_date                    NOT NULL DEFAULT now(),
  PRIMARY KEY (restream_session_id, restream_destination_id),
  FOREIGN KEY (restream_session_id, user_id)
  REFERENCES restream_session (restream_session_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (restream_destination_id, user_id)
  REFERENCES restream_destination (restream_destination_id, user_id) ON DELETE CASCADE
);

-- migrate:down
DROP TABLE restream_session_destination;
DROP TABLE restream_session;
DROP TABLE restream_destination;
DROP TABLE restream_ingest;
DROP TYPE restream_session_status;
DROP TYPE restream_destination_state;
DROP TYPE restream_destination_platform;
