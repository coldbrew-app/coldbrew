CREATE TYPE donation_source AS ENUM ('donationalerts');
CREATE TYPE video_provider AS ENUM ('youtube');

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
  user_id        serial        PRIMARY KEY,
  auth_user_id   text          UNIQUE NOT NULL REFERENCES auth_user (id),
  slug           varchar(48)   UNIQUE NOT NULL DEFAULT ('@' || gen_random_uuid()::text)
                               CHECK (slug ~ '^@[a-zA-Z0-9\-]{3,47}$'),
  queue_currency currency_code NOT NULL DEFAULT 'RUB'
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
  watched_at        js_date            NULL,
  saved_at          js_date            NULL,
  video_priority_id int                NULL REFERENCES video_priority (video_priority_id),
  UNIQUE (donation_id, provider, provider_video_id),
  CHECK (
    (donation_id IS NOT NULL AND user_id IS NULL AND added_at IS NULL) OR
    (donation_id IS NULL AND user_id IS NOT NULL AND added_at IS NOT NULL)
  ),
  CHECK (end_seconds > start_seconds)
);

-- functions and triggers

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
  WHERE video_priority.user_id = COALESCE(
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
      COALESCE(
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
