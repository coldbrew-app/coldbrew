-- migrate:up
ALTER TYPE donation_source ADD VALUE 'streamelements';

CREATE TYPE donation_source_connection_status AS ENUM (
  'connected',
  'reauthorization_required',
  'error'
);

CREATE TABLE streamelements_connection (
  user_id            int                               PRIMARY KEY REFERENCES "user" (user_id)
  ON DELETE CASCADE,
  source_user_id     text                              NOT NULL UNIQUE,
  access_token       text                              NOT NULL,
  refresh_token      text                              NOT NULL,
  token_version      int                               NOT NULL DEFAULT 1 CHECK (token_version > 0),
  history_checkpoint text                                  NULL,
  status             donation_source_connection_status NOT NULL DEFAULT 'connected',
  connected_at       js_date                           NOT NULL DEFAULT now(),
  updated_at         js_date                           NOT NULL DEFAULT now()
);

-- migrate:down
DO $$
BEGIN
  RAISE EXCEPTION 'StreamElements cannot be rolled back without discarding donations and connection credentials';
END;
$$;
