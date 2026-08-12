CREATE TYPE donation_origin AS ENUM ('donationalerts');
CREATE DOMAIN js_date AS timestamptz(3);
CREATE DOMAIN uint AS integer CHECK (VALUE >= 0);
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
  "userId"    text    NOT NULL REFERENCES "auth_user" ("id") ON DELETE CASCADE
);

CREATE TABLE auth_account (
  "id"                    text    PRIMARY KEY,
  "accountId"             text    NOT NULL,
  "providerId"            text    NOT NULL,
  "userId"                text    NOT NULL REFERENCES "auth_user" ("id") ON DELETE CASCADE,
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

CREATE INDEX "auth_session_userId_idx" ON "auth_session" ("userId");
CREATE INDEX "auth_account_userId_idx" ON "auth_account" ("userId");
CREATE INDEX "auth_verification_identifier_idx" ON "auth_verification" ("identifier");

-- main

CREATE TABLE "user" (
  user_id                       serial      PRIMARY KEY,
  auth_user_id                  text        UNIQUE NOT NULL REFERENCES auth_user (id),
  slug                          varchar(48) UNIQUE NOT NULL DEFAULT ('@' || gen_random_uuid()::text) CHECK (slug ~ '^@[a-zA-Z0-9\\-]{3,47}$'),

  donationalerts_access_token   text NULL,
  donationalerts_refresh_token  text NULL
);

CREATE TABLE donation (
  donation_id         bigint          PRIMARY KEY GENERATED ALWAYS AS IDENTITY,

  origin              donation_origin NOT NULL,
  origin_donation_id  text            NOT NULL,

  user_id             int             NOT NULL REFERENCES "user" (user_id),
  author              text                NULL,
  message             text                NULL,
  amount              float           NOT NULL,
  created_at          js_date         NOT NULL,
  videos_parsed_at    js_date             NULL,
  UNIQUE (origin, origin_donation_id)
);

CREATE INDEX donation_videos_unparsed_idx ON donation (created_at) WHERE videos_parsed_at IS NULL;

CREATE TABLE video_priority (
  video_priority_id     serial  PRIMARY KEY,
  user_id               int     REFERENCES "user" (user_id),
  label                 text    NOT NULL,
  min_price_per_minute  float   NOT NULL,
  UNIQUE (user_id, min_price_per_minute)
);

CREATE TABLE video (
  video_id          serial  PRIMARY KEY,
  donation_id       int     NOT NULL REFERENCES donation (donation_id),
  url               text    NOT NULL,
  amount            float   NOT NULL,
  duration_minutes  uint        NULL,
  watched_at        js_date     NULL,
  saved_at          js_date     NULL,
  video_priority_id int     NOT NULL REFERENCES video_priority (video_priority_id),
  UNIQUE (donation_id, url)
);

-- functions and triggers

CREATE FUNCTION set_video_priority_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  SELECT video_priority.video_priority_id
  INTO NEW.video_priority_id
  FROM donation
  JOIN video_priority ON video_priority.user_id = donation.user_id
  WHERE donation.donation_id = NEW.donation_id
    AND video_priority.min_price_per_minute < NEW.amount / NEW.duration_minutes
  ORDER BY video_priority.min_price_per_minute DESC, video_priority.video_priority_id ASC
  LIMIT 1;

  RETURN NEW;
END;
$$;

CREATE TRIGGER set_video_priority_id
BEFORE INSERT OR UPDATE OF amount, duration_minutes, donation_id ON video
FOR EACH ROW
EXECUTE FUNCTION set_video_priority_id();
