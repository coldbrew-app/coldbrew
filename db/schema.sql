CREATE TYPE donation_source AS ENUM ('donationalerts');
CREATE TYPE video_provider AS ENUM ('youtube');
CREATE TYPE chat_provider AS ENUM ('youtube', 'twitch', 'kick', 'boosty', 'vk_video');
CREATE TYPE chat_provider_connection_status AS ENUM ('connected', 'refresh_required', 'error');
CREATE TYPE chat_moderation_action_type AS ENUM (
  'delete_message',
  'timeout_user',
  'ban_user',
  'unban_user',
  'send_message'
);
CREATE TYPE chat_moderation_action_status AS ENUM ('succeeded', 'failed', 'unsupported');

CREATE DOMAIN js_date AS timestamptz(3);
CREATE DOMAIN positive_int AS integer CHECK (VALUE > 0);
CREATE DOMAIN nonnegative_int AS integer CHECK (VALUE >= 0);
CREATE DOMAIN currency_code AS char(3) CHECK (VALUE ~ '^[A-Z]{3}$');
CREATE DOMAIN money_amount AS numeric(20, 2) CHECK (VALUE >= 0);
-- auth

CREATE TABLE auth_user (
  "id"            text    PRIMARY KEY,
  "name"          text    NOT NULL,
  "email"         text    NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL,
  "image"         text        NULL,
  "createdAt"     js_date NOT NULL DEFAULT now(),
  "updatedAt"     js_date NOT NULL DEFAULT now()
);

CREATE TABLE auth_session (
  "id"        text    PRIMARY KEY,
  "expiresAt" js_date NOT NULL,
  "token"     text    NOT NULL UNIQUE,
  "createdAt" js_date NOT NULL DEFAULT now(),
  "updatedAt" js_date NOT NULL,
  "ipAddress" text        NULL,
  "userAgent" text        NULL,
  "userId"    text    NOT NULL REFERENCES auth_user ("id") ON DELETE CASCADE
);

CREATE TABLE auth_account (
  "id"                    text    PRIMARY KEY,
  "accountId"             text    NOT NULL,
  "providerId"            text    NOT NULL,
  "userId"                text    NOT NULL REFERENCES auth_user ("id") ON DELETE CASCADE,
  "accessToken"           text        NULL,
  "refreshToken"          text        NULL,
  "idToken"               text        NULL,
  "accessTokenExpiresAt"  js_date     NULL,
  "refreshTokenExpiresAt" js_date     NULL,
  "scope"                 text        NULL,
  "password"              text        NULL,
  "createdAt"             js_date NOT NULL DEFAULT now(),
  "updatedAt"             js_date NOT NULL
);

CREATE TABLE auth_verification (
  "id"          text    PRIMARY KEY,
  "identifier"  text    NOT NULL,
  "value"       text    NOT NULL,
  "expiresAt"   js_date NOT NULL,
  "createdAt"   js_date NOT NULL DEFAULT now(),
  "updatedAt"   js_date NOT NULL DEFAULT now()
);

CREATE INDEX "auth_session_userId_idx" ON auth_session ("userId");
CREATE INDEX "auth_account_userId_idx" ON auth_account ("userId");
CREATE INDEX "auth_verification_identifier_idx" ON auth_verification ("identifier");

-- streamers and integrations

CREATE TABLE "user" (
  user_id                   serial        PRIMARY KEY,
  auth_user_id              text          UNIQUE NOT NULL REFERENCES auth_user (id),
  slug                      varchar(47)   UNIQUE NOT NULL DEFAULT gen_random_uuid()::text
                                          CHECK (slug ~ '^[a-zA-Z0-9\-]{3,47}$'),
  queue_currency            currency_code NOT NULL DEFAULT 'RUB',
  public_queue_enabled      boolean       NOT NULL DEFAULT true,
  public_queue_show_amounts boolean       NOT NULL DEFAULT true,
  public_queue_show_watched boolean       NOT NULL DEFAULT true
);

CREATE TABLE donationalerts_connection (
  user_id            int     PRIMARY KEY REFERENCES "user" (user_id) ON DELETE CASCADE,
  source_user_id     text    NOT NULL UNIQUE,
  access_token       text    NOT NULL,
  refresh_token      text    NOT NULL,
  token_version      int     NOT NULL DEFAULT 1 CHECK (token_version > 0),
  history_checkpoint text        NULL,
  connected_at       js_date NOT NULL DEFAULT now(),
  updated_at         js_date NOT NULL DEFAULT now()
);

CREATE TABLE chat_overlay (
  user_id    int      PRIMARY KEY REFERENCES "user" (user_id) ON DELETE CASCADE,
  token_hash char(64)     NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  updated_at js_date  NOT NULL DEFAULT now()
);

CREATE TABLE chat_provider_connection (
  chat_provider_connection_id uuid                            PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     int                             NOT NULL REFERENCES "user" (user_id)
                                                               ON DELETE CASCADE,
  provider                    chat_provider                   NOT NULL,
  provider_user_id            text                            NOT NULL
                                                               CHECK (char_length(provider_user_id) BETWEEN 1 AND 200),
  display_name                text                            NOT NULL
                                                               CHECK (char_length(display_name) BETWEEN 1 AND 200),
  access_token_ciphertext     bytea                               NULL,
  refresh_token_ciphertext    bytea                               NULL,
  access_token_expires_at     js_date                             NULL,
  scopes                      text[]                          NOT NULL DEFAULT '{}',
  status                      chat_provider_connection_status NOT NULL DEFAULT 'connected',
  token_version               positive_int                    NOT NULL DEFAULT 1,
  connected_at                js_date                         NOT NULL DEFAULT now(),
  updated_at                  js_date                         NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_user_id),
  UNIQUE (chat_provider_connection_id, user_id, provider)
);

CREATE INDEX chat_provider_connection_user_idx
  ON chat_provider_connection (user_id, connected_at);

CREATE TABLE chat_source (
  chat_source_id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_provider_connection_id uuid          NOT NULL,
  user_id                     int           NOT NULL REFERENCES "user" (user_id) ON DELETE CASCADE,
  provider                    chat_provider NOT NULL,
  provider_source_id          text          NOT NULL
                                             CHECK (char_length(provider_source_id) BETWEEN 1 AND 200),
  display_name                text          NOT NULL
                                             CHECK (char_length(display_name) BETWEEN 1 AND 200),
  source_url                  text          NOT NULL,
  position                    nonnegative_int NOT NULL CHECK (position < 20),
  enabled                     boolean       NOT NULL DEFAULT true,
  show_in_overlay             boolean       NOT NULL DEFAULT true,
  created_at                  js_date       NOT NULL DEFAULT now(),
  updated_at                  js_date       NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider, provider_source_id),
  UNIQUE (user_id, position),
  UNIQUE (chat_source_id, user_id),
  FOREIGN KEY (chat_provider_connection_id, user_id, provider)
    REFERENCES chat_provider_connection (chat_provider_connection_id, user_id, provider)
    ON DELETE CASCADE
);

CREATE INDEX chat_source_connection_idx
  ON chat_source (chat_provider_connection_id, position);

CREATE INDEX chat_source_user_enabled_idx
  ON chat_source (user_id, position)
  WHERE enabled;

CREATE TABLE chat_oauth_attempt (
  state_hash             char(64)      PRIMARY KEY CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  user_id                int           NOT NULL REFERENCES "user" (user_id) ON DELETE CASCADE,
  provider               chat_provider NOT NULL,
  pkce_verifier_ciphertext bytea       NOT NULL,
  return_url             text          NOT NULL,
  expires_at             js_date       NOT NULL,
  created_at             js_date       NOT NULL DEFAULT now()
);

CREATE INDEX chat_oauth_attempt_expires_idx
  ON chat_oauth_attempt (expires_at);

CREATE TABLE chat_provider_ban (
  chat_source_id  uuid          NOT NULL REFERENCES chat_source (chat_source_id) ON DELETE CASCADE,
  provider_user_id text         NOT NULL,
  provider_ban_id text          NOT NULL,
  updated_at      js_date       NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_source_id, provider_user_id)
);

CREATE TABLE chat_moderation_action (
  chat_moderation_action_id bigint                         PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id                   int                            NOT NULL REFERENCES "user" (user_id)
                                                             ON DELETE CASCADE,
  chat_source_id            uuid                           NOT NULL,
  provider                  chat_provider                  NOT NULL,
  action_type               chat_moderation_action_type    NOT NULL,
  status                    chat_moderation_action_status  NOT NULL,
  provider_message_id       text                               NULL,
  provider_user_id          text                               NULL,
  duration_seconds          positive_int                       NULL,
  reason                    text                               NULL,
  detail                    text                               NULL,
  occurred_at               js_date                        NOT NULL DEFAULT now()
);

CREATE INDEX chat_moderation_action_user_occurred_idx
  ON chat_moderation_action (user_id, occurred_at DESC, chat_moderation_action_id DESC);

-- Legacy rows are retained for a non-destructive rollout. The application no longer reads or
-- writes arbitrary URL sources; this table can be dropped in a separately approved migration.
CREATE TABLE chat_overlay_source (
  chat_overlay_source_id serial          PRIMARY KEY,
  user_id                int             NOT NULL REFERENCES chat_overlay (user_id)
                                         ON DELETE CASCADE,
  provider               chat_provider   NOT NULL,
  source_identifier      text            NOT NULL
                                         CHECK (char_length(source_identifier) BETWEEN 1 AND 100),
  source_url             text            NOT NULL,
  position               nonnegative_int NOT NULL CHECK (position < 8),
  UNIQUE (user_id, provider, source_identifier),
  UNIQUE (user_id, position)
);

CREATE INDEX chat_overlay_source_user_position_idx
  ON chat_overlay_source (user_id, position);

CREATE TABLE donation (
  donation_id             bigint          PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  source                  donation_source NOT NULL,
  source_donation_id      text            NOT NULL,
  user_id                 int             NOT NULL REFERENCES "user" (user_id) ON DELETE CASCADE,
  author                  text                NULL,
  message                 text                NULL,
  amount                  money_amount    NOT NULL,
  currency                currency_code   NOT NULL,
  source_created_at       text            NOT NULL,
  occurred_at             js_date         NOT NULL,
  videos_parsed_at        js_date             NULL,
  UNIQUE (user_id, source, source_donation_id)
);

CREATE INDEX donation_videos_unparsed_idx ON donation (occurred_at) WHERE videos_parsed_at IS NULL;
CREATE INDEX donation_user_occurred_idx ON donation (user_id, occurred_at DESC, donation_id DESC);

CREATE TABLE donation_video_scan (
  donation_id      bigint          PRIMARY KEY REFERENCES donation (donation_id) ON DELETE CASCADE,
  generation       bigint          NOT NULL DEFAULT 0 CHECK (generation >= 0),
  attempts         nonnegative_int NOT NULL DEFAULT 0,
  available_at     js_date         NOT NULL DEFAULT now(),
  lease_expires_at js_date             NULL,
  completed_at     js_date             NULL,
  last_error       text                NULL CHECK (char_length(last_error) <= 1000),
  CHECK (completed_at IS NULL OR lease_expires_at IS NULL)
);

CREATE INDEX donation_video_scan_available_idx
  ON donation_video_scan (available_at, lease_expires_at, donation_id)
  WHERE completed_at IS NULL;

CREATE TABLE video_priority (
  video_priority_id    serial        PRIMARY KEY,
  user_id              int           NOT NULL REFERENCES "user" (user_id) ON DELETE CASCADE,
  label                text          NOT NULL CHECK (char_length(trim(label)) BETWEEN 1 AND 64),
  min_price_per_minute money_amount  NOT NULL,
  is_default           boolean       NOT NULL DEFAULT false,
  CHECK ((is_default AND min_price_per_minute = 0) OR
         (NOT is_default AND min_price_per_minute > 0)),
  UNIQUE (user_id, label)
);

CREATE UNIQUE INDEX video_priority_default_idx
  ON video_priority (user_id)
  WHERE is_default;

CREATE TABLE video (
  video_id          bigint         PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  donation_id       bigint             NULL REFERENCES donation (donation_id) ON DELETE CASCADE,
  user_id           int                NULL REFERENCES "user" (user_id) ON DELETE CASCADE,
  added_at          js_date             NULL,
  provider          video_provider NOT NULL,
  provider_video_id text           NOT NULL,
  url               text           NOT NULL,
  queue_amount      money_amount       NULL,
  start_seconds     nonnegative_int NOT NULL,
  end_seconds       positive_int    NOT NULL,
  duration_seconds  positive_int    NOT NULL,
  watched_at        js_date            NULL,
  bookmarked_at     js_date            NULL,
  video_priority_id int                NULL REFERENCES video_priority (video_priority_id),
  UNIQUE (donation_id, provider, provider_video_id),
  CHECK (
    (donation_id IS NOT NULL AND user_id IS NULL AND added_at IS NULL) OR
    (donation_id IS NULL AND user_id IS NOT NULL AND added_at IS NOT NULL)
  ),
  CHECK (end_seconds > start_seconds)
);

CREATE INDEX video_watched_idx ON video (watched_at DESC, video_id DESC)
  WHERE watched_at IS NOT NULL;
CREATE INDEX video_bookmarked_idx ON video (bookmarked_at DESC, video_id DESC)
  WHERE bookmarked_at IS NOT NULL;

-- functions and triggers

CREATE FUNCTION enqueue_donation_video_scan()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.videos_parsed_at IS NULL THEN
    INSERT INTO donation_video_scan (donation_id)
    VALUES (NEW.donation_id)
    ON CONFLICT (donation_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER enqueue_donation_video_scan
AFTER INSERT ON donation
FOR EACH ROW
EXECUTE FUNCTION enqueue_donation_video_scan();

CREATE FUNCTION set_video_priority_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.queue_amount IS NULL THEN
    NEW.video_priority_id := NULL;
    RETURN NEW;
  END IF;

  SELECT video_priority.video_priority_id
  INTO NEW.video_priority_id
  FROM video_priority
  WHERE video_priority.user_id = coalesce(
      NEW.user_id,
      (SELECT donation.user_id
       FROM donation
       WHERE donation.donation_id = NEW.donation_id)
    )
    AND video_priority.min_price_per_minute <=
      NEW.queue_amount * 60 / (NEW.end_seconds - NEW.start_seconds)
  ORDER BY video_priority.min_price_per_minute DESC, video_priority.video_priority_id ASC
  LIMIT 1;

  IF NEW.video_priority_id IS NULL THEN
    RAISE EXCEPTION 'no video priority for user %, amount %, start %, end %',
      coalesce(
        NEW.user_id,
        (SELECT donation.user_id
         FROM donation
         WHERE donation.donation_id = NEW.donation_id)
      ),
      NEW.queue_amount, NEW.start_seconds, NEW.end_seconds;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER set_video_priority_id
BEFORE INSERT OR UPDATE OF queue_amount, start_seconds, end_seconds, donation_id, user_id ON video
FOR EACH ROW
EXECUTE FUNCTION set_video_priority_id();
