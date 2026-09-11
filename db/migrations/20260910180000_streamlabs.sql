-- migrate:up
ALTER TYPE donation_source ADD VALUE 'streamlabs';

CREATE TABLE streamlabs_connection (
  user_id            int     PRIMARY KEY REFERENCES "user" (user_id) ON DELETE CASCADE,
  source_user_id     text    NOT NULL UNIQUE,
  access_token       text    NOT NULL,
  refresh_token      text    NOT NULL,
  token_version      int     NOT NULL DEFAULT 1 CHECK (token_version > 0),
  history_checkpoint text,
  connected_at       js_date NOT NULL DEFAULT now(),
  updated_at         js_date NOT NULL DEFAULT now()
);

-- migrate:down
DO $$
BEGIN
  RAISE EXCEPTION 'Streamlabs cannot be rolled back without discarding donations and connection credentials';
END;
$$;
