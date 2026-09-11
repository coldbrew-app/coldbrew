-- migrate:up
ALTER TYPE donation_source ADD VALUE IF NOT EXISTS 'donate_stream';

CREATE TABLE IF NOT EXISTS donate_stream_connection (
  user_id          int     PRIMARY KEY REFERENCES "user" (user_id) ON DELETE CASCADE,
  widget_group_uid text    NOT NULL UNIQUE,
  widget_token     text    NOT NULL,
  connected_at     js_date NOT NULL DEFAULT now(),
  updated_at       js_date NOT NULL DEFAULT now()
);

-- migrate:down
DROP TABLE IF EXISTS donate_stream_connection;
