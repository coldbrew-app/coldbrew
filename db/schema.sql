\restrict dbmate

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', FALSE);
SET check_function_bodies = FALSE;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

CREATE SCHEMA auth;

CREATE TYPE public.chat_moderation_action_status AS ENUM (
  'succeeded',
  'failed',
  'unsupported'
);

CREATE TYPE public.chat_moderation_action_type AS ENUM (
  'delete_message',
  'timeout_user',
  'ban_user',
  'unban_user',
  'send_message'
);

CREATE TYPE public.chat_provider AS ENUM (
  'youtube',
  'twitch',
  'kick',
  'boosty',
  'vk_video'
);

CREATE TYPE public.chat_provider_connection_status AS ENUM (
  'connected',
  'refresh_required',
  'error'
);

CREATE DOMAIN public.currency_code AS character(3)
CONSTRAINT currency_code_check CHECK ((value ~ '^[A-Z]{3}$'::text));

CREATE TYPE public.donation_alert_asset_kind AS ENUM (
  'image',
  'sound',
  'tts'
);

CREATE TYPE public.donation_alert_playback_kind AS ENUM (
  'incoming',
  'replay',
  'test'
);

CREATE TYPE public.donation_alert_playback_status AS ENUM (
  'preparing',
  'pending',
  'playing',
  'completed',
  'skipped',
  'expired',
  'interrupted'
);

CREATE TYPE public.donation_source AS ENUM (
  'donationalerts',
  'donate_stream',
  'streamlabs'
);

CREATE DOMAIN public.js_date AS timestamp (3) with time zone;

CREATE DOMAIN public.money_amount AS numeric(20, 2)
CONSTRAINT money_amount_check CHECK ((value >= (0)::numeric));

CREATE DOMAIN public.nonnegative_int AS integer
CONSTRAINT nonnegative_int_check CHECK ((value >= 0));

CREATE DOMAIN public.positive_int AS integer
CONSTRAINT positive_int_check CHECK ((value > 0));

CREATE TYPE public.video_provider AS ENUM (
  'youtube'
);

CREATE FUNCTION public.enqueue_donation_video_scan() RETURNS trigger
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

CREATE FUNCTION public.enqueue_video_metadata_job() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.duration_seconds IS NULL THEN
    INSERT INTO video_metadata_job (video_id) VALUES (NEW.video_id)
    ON CONFLICT (video_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.set_video_priority_id() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  owner_id int;
BEGIN
  owner_id := coalesce(
    NEW.user_id,
    (SELECT user_id FROM donation WHERE donation_id = NEW.donation_id)
  );

  IF NEW.video_queue_id IS NULL THEN
    SELECT video_queue_id
    INTO NEW.video_queue_id
    FROM video_queue
    WHERE user_id = owner_id
      AND is_default;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM video_queue
    WHERE video_queue_id = NEW.video_queue_id
      AND user_id = owner_id
  ) THEN
    RAISE EXCEPTION 'video queue does not belong to video owner';
  END IF;

  IF NEW.video_priority_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM video_priority
    WHERE video_priority_id = NEW.video_priority_id
      AND user_id = owner_id
  ) THEN
    RAISE EXCEPTION 'video priority does not belong to video owner';
  END IF;

  IF NEW.queue_amount IS NULL OR NEW.end_seconds IS NULL OR
     (NEW.duration_seconds IS NOT NULL AND NEW.start_seconds >= NEW.duration_seconds) THEN
    NEW.video_priority_id := NULL;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND
     NEW.queue_amount IS NOT DISTINCT FROM OLD.queue_amount AND
     NEW.start_seconds = OLD.start_seconds AND
     NEW.end_seconds IS NOT DISTINCT FROM OLD.end_seconds AND
     NEW.donation_id IS NOT DISTINCT FROM OLD.donation_id AND
     NEW.user_id IS NOT DISTINCT FROM OLD.user_id AND
     NEW.video_priority_id IS NOT DISTINCT FROM OLD.video_priority_id AND
     OLD.video_priority_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT video_priority.video_priority_id
  INTO NEW.video_priority_id
  FROM video_priority
  WHERE video_priority.user_id = owner_id
    AND video_priority.min_price_per_minute <=
      NEW.queue_amount * 60 / (NEW.end_seconds - NEW.start_seconds)
  ORDER BY video_priority.min_price_per_minute DESC, video_priority.video_priority_id ASC
  LIMIT 1;

  IF NEW.video_priority_id IS NULL THEN
    RAISE EXCEPTION 'no video priority for user %, amount %, start %, end %',
      owner_id, NEW.queue_amount, NEW.start_seconds, NEW.end_seconds;
  END IF;

  RETURN NEW;
END;
$$;

SET default_tablespace = '';

SET default_table_access_method = heap;

CREATE TABLE auth.auth_account (
  id                      text           NOT NULL,
  "accountId"             text           NOT NULL,
  "providerId"            text           NOT NULL,
  "userId"                text           NOT NULL,
  "accessToken"           text,
  "refreshToken"          text,
  "idToken"               text,
  "accessTokenExpiresAt"  public.js_date,
  "refreshTokenExpiresAt" public.js_date,
  scope                   text,
  password                text,
  "createdAt"             public.js_date DEFAULT now() NOT NULL,
  "updatedAt"             public.js_date NOT NULL
);

CREATE TABLE auth.auth_session (
  id          text           NOT NULL,
  "expiresAt" public.js_date NOT NULL,
  token       text           NOT NULL,
  "createdAt" public.js_date DEFAULT now() NOT NULL,
  "updatedAt" public.js_date NOT NULL,
  "ipAddress" text,
  "userAgent" text,
  "userId"    text           NOT NULL
);

CREATE TABLE auth.auth_user (
  id              text           NOT NULL,
  name            text           NOT NULL,
  email           text           NOT NULL,
  "emailVerified" boolean        NOT NULL,
  image           text,
  "createdAt"     public.js_date DEFAULT now() NOT NULL,
  "updatedAt"     public.js_date DEFAULT now() NOT NULL
);

CREATE TABLE auth.auth_verification (
  id          text           NOT NULL,
  identifier  text           NOT NULL,
  value       text           NOT NULL,
  "expiresAt" public.js_date NOT NULL,
  "createdAt" public.js_date DEFAULT now() NOT NULL,
  "updatedAt" public.js_date DEFAULT now() NOT NULL
);

CREATE TABLE public.chat_moderation_action (
  chat_moderation_action_id bigint                               NOT NULL,
  user_id                   integer                              NOT NULL,
  chat_source_id            uuid                                 NOT NULL,
  provider                  public.chat_provider                 NOT NULL,
  action_type               public.chat_moderation_action_type   NOT NULL,
  status                    public.chat_moderation_action_status NOT NULL,
  provider_message_id       text,
  provider_user_id          text,
  duration_seconds          public.positive_int,
  reason                    text,
  detail                    text,
  occurred_at               public.js_date                       DEFAULT now() NOT NULL
);

ALTER TABLE public.chat_moderation_action ALTER COLUMN chat_moderation_action_id ADD GENERATED ALWAYS AS IDENTITY (
  SEQUENCE NAME public.chat_moderation_action_chat_moderation_action_id_seq
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1
);

CREATE TABLE public.chat_oauth_attempt (
  state_hash               character(64)        NOT NULL,
  user_id                  integer              NOT NULL,
  provider                 public.chat_provider NOT NULL,
  pkce_verifier_ciphertext bytea                NOT NULL,
  return_url               text                 NOT NULL,
  expires_at               public.js_date       NOT NULL,
  created_at               public.js_date       DEFAULT now() NOT NULL,
  CONSTRAINT chat_oauth_attempt_state_hash_check CHECK ((state_hash ~ '^[0-9a-f]{64}$'::text))
);

CREATE TABLE public.chat_overlay (
  user_id    integer        NOT NULL,
  token_hash character(64),
  updated_at public.js_date DEFAULT now() NOT NULL,
  CONSTRAINT chat_overlay_token_hash_check CHECK ((token_hash ~ '^[0-9a-f]{64}$'::text))
);

CREATE TABLE public.chat_overlay_source (
  chat_overlay_source_id integer                NOT NULL,
  user_id                integer                NOT NULL,
  provider               public.chat_provider   NOT NULL,
  source_identifier      text                   NOT NULL,
  source_url             text                   NOT NULL,
  "position"             public.nonnegative_int NOT NULL,
  CONSTRAINT chat_overlay_source_position_check CHECK ((("position")::integer < 8)),
  CONSTRAINT chat_overlay_source_source_identifier_check CHECK (((char_length(source_identifier) >= 1) AND (char_length(source_identifier) <= 100)))
);

CREATE SEQUENCE public.chat_overlay_source_chat_overlay_source_id_seq
AS integer
START WITH 1
INCREMENT BY 1
NO MINVALUE
NO MAXVALUE
CACHE 1;

ALTER SEQUENCE public.chat_overlay_source_chat_overlay_source_id_seq OWNED BY public.chat_overlay_source.chat_overlay_source_id;

CREATE TABLE public.chat_provider_ban (
  chat_source_id   uuid           NOT NULL,
  provider_user_id text           NOT NULL,
  provider_ban_id  text           NOT NULL,
  updated_at       public.js_date DEFAULT now() NOT NULL
);

CREATE TABLE public.chat_provider_connection (
  chat_provider_connection_id uuid                                   DEFAULT gen_random_uuid() NOT NULL,
  user_id                     integer                                NOT NULL,
  provider                    public.chat_provider                   NOT NULL,
  provider_user_id            text                                   NOT NULL,
  display_name                text                                   NOT NULL,
  access_token_ciphertext     bytea,
  refresh_token_ciphertext    bytea,
  access_token_expires_at     public.js_date,
  scopes                      text[]                                 DEFAULT '{}'::text[] NOT NULL,
  status                      public.chat_provider_connection_status DEFAULT 'connected'::public.chat_provider_connection_status NOT NULL,
  token_version               public.positive_int                    DEFAULT 1 NOT NULL,
  connected_at                public.js_date                         DEFAULT now() NOT NULL,
  updated_at                  public.js_date                         DEFAULT now() NOT NULL,
  oauth_device_id             text,
  CONSTRAINT chat_provider_connection_display_name_check CHECK (((char_length(display_name) >= 1) AND (char_length(display_name) <= 200))),
  CONSTRAINT chat_provider_connection_oauth_device_id_check CHECK (((char_length(oauth_device_id) >= 1) AND (char_length(oauth_device_id) <= 200))),
  CONSTRAINT chat_provider_connection_provider_user_id_check CHECK (((char_length(provider_user_id) >= 1) AND (char_length(provider_user_id) <= 200)))
);

CREATE TABLE public.chat_source (
  chat_source_id              uuid                   DEFAULT gen_random_uuid() NOT NULL,
  chat_provider_connection_id uuid                   NOT NULL,
  user_id                     integer                NOT NULL,
  provider                    public.chat_provider   NOT NULL,
  provider_source_id          text                   NOT NULL,
  display_name                text                   NOT NULL,
  source_url                  text                   NOT NULL,
  "position"                  public.nonnegative_int NOT NULL,
  enabled                     boolean                DEFAULT TRUE NOT NULL,
  show_in_overlay             boolean                DEFAULT TRUE NOT NULL,
  created_at                  public.js_date         DEFAULT now() NOT NULL,
  updated_at                  public.js_date         DEFAULT now() NOT NULL,
  CONSTRAINT chat_source_display_name_check CHECK (((char_length(display_name) >= 1) AND (char_length(display_name) <= 200))),
  CONSTRAINT chat_source_position_check CHECK ((("position")::integer < 20)),
  CONSTRAINT chat_source_provider_source_id_check CHECK (((char_length(provider_source_id) >= 1) AND (char_length(provider_source_id) <= 200)))
);

CREATE TABLE public.donate_stream_connection (
  user_id          integer        NOT NULL,
  widget_group_uid text           NOT NULL,
  widget_token     text           NOT NULL,
  connected_at     public.js_date DEFAULT now() NOT NULL,
  updated_at       public.js_date DEFAULT now() NOT NULL
);

CREATE TABLE public.donation (
  donation_id        bigint                 NOT NULL,
  source             public.donation_source NOT NULL,
  source_donation_id text                   NOT NULL,
  user_id            integer                NOT NULL,
  author             text,
  message            text,
  amount             public.money_amount    NOT NULL,
  currency           public.currency_code   NOT NULL,
  source_created_at  text                   NOT NULL,
  occurred_at        public.js_date         NOT NULL,
  videos_parsed_at   public.js_date
);

CREATE TABLE public.donation_alert_asset (
  donation_alert_asset_id uuid                             DEFAULT gen_random_uuid() NOT NULL,
  user_id                 integer                          NOT NULL,
  kind                    public.donation_alert_asset_kind NOT NULL,
  mime_type               text                             NOT NULL,
  content                 bytea                            NOT NULL,
  content_hash            character(64)                    NOT NULL,
  duration_ms             public.nonnegative_int,
  created_at              public.js_date                   DEFAULT now() NOT NULL,
  CONSTRAINT donation_alert_asset_content_check CHECK (((octet_length(content) >= 1) AND (octet_length(content) <= 10485760))),
  CONSTRAINT donation_alert_asset_content_hash_check CHECK ((content_hash ~ '^[0-9a-f]{64}$'::text)),
  CONSTRAINT donation_alert_asset_mime_type_check CHECK (((char_length(mime_type) >= 1) AND (char_length(mime_type) <= 100)))
);

CREATE TABLE public.donation_alert_configuration (
  user_id             integer                NOT NULL,
  enabled             boolean                DEFAULT FALSE NOT NULL,
  paused              boolean                DEFAULT FALSE NOT NULL,
  display_duration_ms public.positive_int    DEFAULT 7000 NOT NULL,
  sound_volume        public.nonnegative_int DEFAULT 80 NOT NULL,
  tts_enabled         boolean                DEFAULT FALSE NOT NULL,
  tts_voice           text                   DEFAULT 'ru'::text NOT NULL,
  tts_volume          public.nonnegative_int DEFAULT 80 NOT NULL,
  accent_color        character(7)           DEFAULT '#f59e0b'::bpchar NOT NULL,
  image_asset_id      uuid,
  sound_asset_id      uuid,
  updated_at          public.js_date         DEFAULT now() NOT NULL,
  CONSTRAINT donation_alert_configuration_accent_color_check CHECK ((accent_color ~ '^#[0-9a-fA-F]{6}$'::text)),
  CONSTRAINT donation_alert_configuration_display_duration_ms_check CHECK ((((display_duration_ms)::integer >= 1000) AND ((display_duration_ms)::integer <= 30000))),
  CONSTRAINT donation_alert_configuration_sound_volume_check CHECK (((sound_volume)::integer <= 100)),
  CONSTRAINT donation_alert_configuration_tts_voice_check CHECK (((char_length(trim(BOTH FROM tts_voice)) >= 1) AND (char_length(trim(BOTH FROM tts_voice)) <= 64))),
  CONSTRAINT donation_alert_configuration_tts_volume_check CHECK (((tts_volume)::integer <= 100))
);

CREATE TABLE public.donation_alert_overlay (
  user_id    integer        NOT NULL,
  token_hash character(64),
  updated_at public.js_date DEFAULT now() NOT NULL,
  CONSTRAINT donation_alert_overlay_token_hash_check CHECK ((token_hash ~ '^[0-9a-f]{64}$'::text))
);

CREATE TABLE public.donation_alert_playback (
  donation_alert_playback_id   uuid                                  DEFAULT gen_random_uuid() NOT NULL,
  queue_sequence               bigint                                NOT NULL,
  user_id                      integer                               NOT NULL,
  donation_id                  bigint,
  kind                         public.donation_alert_playback_kind   NOT NULL,
  status                       public.donation_alert_playback_status NOT NULL,
  source                       public.donation_source,
  author                       text,
  message                      text,
  amount                       public.money_amount                   NOT NULL,
  currency                     public.currency_code                  NOT NULL,
  image_asset_id               uuid,
  sound_asset_id               uuid,
  tts_asset_id                 uuid,
  display_duration_ms          public.positive_int                   NOT NULL,
  sound_volume                 public.nonnegative_int                NOT NULL,
  tts_volume                   public.nonnegative_int                NOT NULL,
  tts_voice                    text                                  NOT NULL,
  accent_color                 character(7)                          NOT NULL,
  created_at                   public.js_date                        NOT NULL,
  available_at                 public.js_date                        NOT NULL,
  expires_at                   public.js_date                        NOT NULL,
  started_at                   public.js_date,
  finished_at                  public.js_date,
  player_id                    uuid,
  player_generation            bigint,
  preparation_generation       bigint                                DEFAULT 0 NOT NULL,
  preparation_attempts         public.nonnegative_int                DEFAULT 0 NOT NULL,
  preparation_lease_expires_at public.js_date,
  last_error                   text,
  CONSTRAINT donation_alert_playback_accent_color_check CHECK ((accent_color ~ '^#[0-9a-fA-F]{6}$'::text)),
  CONSTRAINT donation_alert_playback_author_check CHECK ((char_length(author) <= 200)),
  CONSTRAINT donation_alert_playback_check
    CHECK ((((kind = 'test'::public.donation_alert_playback_kind) AND (donation_id IS NULL)) OR ((kind = any(ARRAY['incoming'::public.donation_alert_playback_kind, 'replay'::public.donation_alert_playback_kind])) AND (donation_id IS NOT NULL)))),
  CONSTRAINT donation_alert_playback_check1 CHECK (((expires_at)::timestamp with time zone > (created_at)::timestamp with time zone)),
  CONSTRAINT donation_alert_playback_display_duration_ms_check CHECK ((((display_duration_ms)::integer >= 1000) AND ((display_duration_ms)::integer <= 30000))),
  CONSTRAINT donation_alert_playback_last_error_check CHECK ((char_length(last_error) <= 1000)),
  CONSTRAINT donation_alert_playback_message_check CHECK ((char_length(message) <= 2000)),
  CONSTRAINT donation_alert_playback_player_generation_check CHECK ((player_generation >= 0)),
  CONSTRAINT donation_alert_playback_preparation_generation_check CHECK ((preparation_generation >= 0)),
  CONSTRAINT donation_alert_playback_sound_volume_check CHECK (((sound_volume)::integer <= 100)),
  CONSTRAINT donation_alert_playback_tts_voice_check CHECK (((char_length(trim(BOTH FROM tts_voice)) >= 1) AND (char_length(trim(BOTH FROM tts_voice)) <= 64))),
  CONSTRAINT donation_alert_playback_tts_volume_check CHECK (((tts_volume)::integer <= 100))
);

ALTER TABLE public.donation_alert_playback ALTER COLUMN queue_sequence ADD GENERATED ALWAYS AS IDENTITY (
  SEQUENCE NAME public.donation_alert_playback_queue_sequence_seq
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1
);

CREATE TABLE public.donation_alert_player (
  user_id          integer        NOT NULL,
  player_id        uuid           NOT NULL,
  generation       bigint         DEFAULT 0 NOT NULL,
  active           boolean        DEFAULT FALSE NOT NULL,
  visible          boolean        DEFAULT FALSE NOT NULL,
  connected_at     public.js_date NOT NULL,
  last_seen_at     public.js_date NOT NULL,
  lease_expires_at public.js_date NOT NULL,
  CONSTRAINT donation_alert_player_generation_check CHECK ((generation >= 0))
);

CREATE TABLE public.donation_alert_renderer_diagnostic (
  donation_alert_playback_id uuid           CONSTRAINT donation_alert_renderer_dia_donation_alert_playback_id_not_null NOT NULL,
  user_id                    integer        NOT NULL,
  code                       text           NOT NULL,
  occurred_at                public.js_date NOT NULL,
  CONSTRAINT donation_alert_renderer_diagnostic_code_check CHECK ((code = any(ARRAY['image_unavailable'::text, 'sound_unavailable'::text, 'tts_unavailable'::text, 'audio_blocked'::text])))
);

CREATE TABLE public.donation_alert_source (
  user_id integer                NOT NULL,
  source  public.donation_source NOT NULL,
  enabled boolean                DEFAULT TRUE NOT NULL
);

ALTER TABLE public.donation ALTER COLUMN donation_id ADD GENERATED ALWAYS AS IDENTITY (
  SEQUENCE NAME public.donation_donation_id_seq
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1
);

CREATE TABLE public.donation_video_scan (
  donation_id      bigint                 NOT NULL,
  generation       bigint                 DEFAULT 0 NOT NULL,
  attempts         public.nonnegative_int DEFAULT 0 NOT NULL,
  available_at     public.js_date         DEFAULT now() NOT NULL,
  lease_expires_at public.js_date,
  completed_at     public.js_date,
  last_error       text,
  CONSTRAINT donation_video_scan_check CHECK (((completed_at IS NULL) OR (lease_expires_at IS NULL))),
  CONSTRAINT donation_video_scan_generation_check CHECK ((generation >= 0)),
  CONSTRAINT donation_video_scan_last_error_check CHECK ((char_length(last_error) <= 1000))
);

CREATE TABLE public.donationalerts_connection (
  user_id            integer        NOT NULL,
  source_user_id     text           NOT NULL,
  access_token       text           NOT NULL,
  refresh_token      text           NOT NULL,
  token_version      integer        DEFAULT 1 NOT NULL,
  history_checkpoint text,
  connected_at       public.js_date DEFAULT now() NOT NULL,
  updated_at         public.js_date DEFAULT now() NOT NULL,
  CONSTRAINT donationalerts_connection_token_version_check CHECK ((token_version > 0))
);

CREATE TABLE public.schema_migrations (
  version character varying NOT NULL
);

CREATE TABLE public.streamlabs_connection (
  user_id            integer        NOT NULL,
  source_user_id     text           NOT NULL,
  access_token       text           NOT NULL,
  refresh_token      text           NOT NULL,
  token_version      integer        DEFAULT 1 NOT NULL,
  history_checkpoint text,
  connected_at       public.js_date DEFAULT now() NOT NULL,
  updated_at         public.js_date DEFAULT now() NOT NULL,
  CONSTRAINT streamlabs_connection_token_version_check CHECK ((token_version > 0))
);

CREATE TABLE public."user" (
  user_id                   integer               NOT NULL,
  auth_user_id              text                  NOT NULL,
  slug                      character varying(47) DEFAULT (gen_random_uuid())::text NOT NULL,
  queue_currency            public.currency_code  DEFAULT 'RUB'::bpchar NOT NULL,
  public_queue_enabled      boolean               DEFAULT TRUE NOT NULL,
  public_queue_show_amounts boolean               DEFAULT TRUE NOT NULL,
  public_queue_show_watched boolean               DEFAULT TRUE NOT NULL,
  CONSTRAINT user_slug_check CHECK (((slug)::text ~ '^[a-zA-Z0-9\-]{3,47}$'::text))
);

CREATE SEQUENCE public.user_user_id_seq
AS integer
START WITH 1
INCREMENT BY 1
NO MINVALUE
NO MAXVALUE
CACHE 1;

ALTER SEQUENCE public.user_user_id_seq OWNED BY public."user".user_id;

CREATE TABLE public.video (
  video_id          bigint                 NOT NULL,
  donation_id       bigint,
  user_id           integer,
  added_at          public.js_date,
  provider          public.video_provider  NOT NULL,
  provider_video_id text                   NOT NULL,
  url               text                   NOT NULL,
  queue_amount      public.money_amount,
  start_seconds     public.nonnegative_int NOT NULL,
  end_seconds       public.positive_int,
  duration_seconds  public.positive_int,
  watched_at        public.js_date,
  bookmarked_at     public.js_date,
  video_priority_id integer,
  title             text,
  video_queue_id    integer                NOT NULL,
  CONSTRAINT video_check CHECK ((((donation_id IS NOT NULL) AND (user_id IS NULL) AND (added_at IS NULL)) OR ((donation_id IS NULL) AND (user_id IS NOT NULL) AND (added_at IS NOT NULL)))),
  CONSTRAINT video_check1 CHECK (((end_seconds)::integer > (start_seconds)::integer)),
  CONSTRAINT video_title_check CHECK (((title IS NULL) OR (btrim(title) <> ''::text)))
);

CREATE TABLE public.video_metadata_job (
  video_id         bigint                 NOT NULL,
  generation       bigint                 DEFAULT 0 NOT NULL,
  attempts         public.nonnegative_int DEFAULT 0 NOT NULL,
  available_at     public.js_date         DEFAULT now() NOT NULL,
  lease_expires_at public.js_date,
  completed_at     public.js_date,
  last_attempt_at  public.js_date,
  last_error_code  text,
  last_http_status integer,
  CONSTRAINT video_metadata_job_check CHECK (((completed_at IS NULL) OR (lease_expires_at IS NULL))),
  CONSTRAINT video_metadata_job_generation_check CHECK ((generation >= 0)),
  CONSTRAINT video_metadata_job_last_error_code_check CHECK ((char_length(last_error_code) <= 64)),
  CONSTRAINT video_metadata_job_last_http_status_check CHECK (((last_http_status >= 100) AND (last_http_status <= 599)))
);

CREATE TABLE public.video_priority (
  video_priority_id    integer             NOT NULL,
  user_id              integer             NOT NULL,
  label                text                NOT NULL,
  min_price_per_minute public.money_amount NOT NULL,
  is_default           boolean             DEFAULT FALSE NOT NULL,
  CONSTRAINT video_priority_check CHECK (((is_default AND ((min_price_per_minute)::numeric = (0)::numeric)) OR ((NOT is_default) AND ((min_price_per_minute)::numeric > (0)::numeric)))),
  CONSTRAINT video_priority_label_check CHECK (((char_length(trim(BOTH FROM label)) >= 1) AND (char_length(trim(BOTH FROM label)) <= 64)))
);

CREATE SEQUENCE public.video_priority_video_priority_id_seq
AS integer
START WITH 1
INCREMENT BY 1
NO MINVALUE
NO MAXVALUE
CACHE 1;

ALTER SEQUENCE public.video_priority_video_priority_id_seq OWNED BY public.video_priority.video_priority_id;

CREATE TABLE public.video_queue (
  video_queue_id integer NOT NULL,
  user_id        integer NOT NULL,
  label          text    NOT NULL,
  is_default     boolean DEFAULT FALSE NOT NULL,
  CONSTRAINT video_queue_label_check CHECK (((char_length(trim(BOTH FROM label)) >= 1) AND (char_length(trim(BOTH FROM label)) <= 64)))
);

CREATE SEQUENCE public.video_queue_video_queue_id_seq
AS integer
START WITH 1
INCREMENT BY 1
NO MINVALUE
NO MAXVALUE
CACHE 1;

ALTER SEQUENCE public.video_queue_video_queue_id_seq OWNED BY public.video_queue.video_queue_id;

ALTER TABLE public.video ALTER COLUMN video_id ADD GENERATED ALWAYS AS IDENTITY (
  SEQUENCE NAME public.video_video_id_seq
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1
);

ALTER TABLE ONLY public.chat_overlay_source ALTER COLUMN chat_overlay_source_id SET DEFAULT nextval('public.chat_overlay_source_chat_overlay_source_id_seq'::regclass);

ALTER TABLE ONLY public."user" ALTER COLUMN user_id SET DEFAULT nextval('public.user_user_id_seq'::regclass);

ALTER TABLE ONLY public.video_priority ALTER COLUMN video_priority_id SET DEFAULT nextval('public.video_priority_video_priority_id_seq'::regclass);

ALTER TABLE ONLY public.video_queue ALTER COLUMN video_queue_id SET DEFAULT nextval('public.video_queue_video_queue_id_seq'::regclass);

ALTER TABLE ONLY auth.auth_account
ADD CONSTRAINT auth_account_pkey PRIMARY KEY (id);

ALTER TABLE ONLY auth.auth_session
ADD CONSTRAINT auth_session_pkey PRIMARY KEY (id);

ALTER TABLE ONLY auth.auth_session
ADD CONSTRAINT auth_session_token_key UNIQUE (token);

ALTER TABLE ONLY auth.auth_user
ADD CONSTRAINT auth_user_email_key UNIQUE (email);

ALTER TABLE ONLY auth.auth_user
ADD CONSTRAINT auth_user_pkey PRIMARY KEY (id);

ALTER TABLE ONLY auth.auth_verification
ADD CONSTRAINT auth_verification_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.chat_moderation_action
ADD CONSTRAINT chat_moderation_action_pkey PRIMARY KEY (chat_moderation_action_id);

ALTER TABLE ONLY public.chat_oauth_attempt
ADD CONSTRAINT chat_oauth_attempt_pkey PRIMARY KEY (state_hash);

ALTER TABLE ONLY public.chat_overlay
ADD CONSTRAINT chat_overlay_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY public.chat_overlay_source
ADD CONSTRAINT chat_overlay_source_pkey PRIMARY KEY (chat_overlay_source_id);

ALTER TABLE ONLY public.chat_overlay_source
ADD CONSTRAINT chat_overlay_source_user_id_position_key UNIQUE (user_id, "position");

ALTER TABLE ONLY public.chat_overlay_source
ADD CONSTRAINT chat_overlay_source_user_id_provider_source_identifier_key UNIQUE (user_id, provider, source_identifier);

ALTER TABLE ONLY public.chat_overlay
ADD CONSTRAINT chat_overlay_token_hash_key UNIQUE (token_hash);

ALTER TABLE ONLY public.chat_provider_ban
ADD CONSTRAINT chat_provider_ban_pkey PRIMARY KEY (chat_source_id, provider_user_id);

ALTER TABLE ONLY public.chat_provider_connection
ADD CONSTRAINT chat_provider_connection_chat_provider_connection_id_user_i_key UNIQUE (chat_provider_connection_id, user_id, provider);

ALTER TABLE ONLY public.chat_provider_connection
ADD CONSTRAINT chat_provider_connection_pkey PRIMARY KEY (chat_provider_connection_id);

ALTER TABLE ONLY public.chat_provider_connection
ADD CONSTRAINT chat_provider_connection_provider_provider_user_id_key UNIQUE (provider, provider_user_id);

ALTER TABLE ONLY public.chat_source
ADD CONSTRAINT chat_source_chat_source_id_user_id_key UNIQUE (chat_source_id, user_id);

ALTER TABLE ONLY public.chat_source
ADD CONSTRAINT chat_source_pkey PRIMARY KEY (chat_source_id);

ALTER TABLE ONLY public.chat_source
ADD CONSTRAINT chat_source_user_id_position_key UNIQUE (user_id, "position");

ALTER TABLE ONLY public.chat_source
ADD CONSTRAINT chat_source_user_id_provider_provider_source_id_key UNIQUE (user_id, provider, provider_source_id);

ALTER TABLE ONLY public.donate_stream_connection
ADD CONSTRAINT donate_stream_connection_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY public.donate_stream_connection
ADD CONSTRAINT donate_stream_connection_widget_group_uid_key UNIQUE (widget_group_uid);

ALTER TABLE ONLY public.donation_alert_asset
ADD CONSTRAINT donation_alert_asset_donation_alert_asset_id_user_id_key UNIQUE (donation_alert_asset_id, user_id);

ALTER TABLE ONLY public.donation_alert_asset
ADD CONSTRAINT donation_alert_asset_pkey PRIMARY KEY (donation_alert_asset_id);

ALTER TABLE ONLY public.donation_alert_asset
ADD CONSTRAINT donation_alert_asset_user_id_kind_content_hash_key UNIQUE (user_id, kind, content_hash);

ALTER TABLE ONLY public.donation_alert_configuration
ADD CONSTRAINT donation_alert_configuration_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY public.donation_alert_overlay
ADD CONSTRAINT donation_alert_overlay_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY public.donation_alert_overlay
ADD CONSTRAINT donation_alert_overlay_token_hash_key UNIQUE (token_hash);

ALTER TABLE ONLY public.donation_alert_playback
ADD CONSTRAINT donation_alert_playback_donation_alert_playback_id_user_id_key UNIQUE (donation_alert_playback_id, user_id);

ALTER TABLE ONLY public.donation_alert_playback
ADD CONSTRAINT donation_alert_playback_pkey PRIMARY KEY (donation_alert_playback_id);

ALTER TABLE ONLY public.donation_alert_playback
ADD CONSTRAINT donation_alert_playback_queue_sequence_key UNIQUE (queue_sequence);

ALTER TABLE ONLY public.donation_alert_player
ADD CONSTRAINT donation_alert_player_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY public.donation_alert_renderer_diagnostic
ADD CONSTRAINT donation_alert_renderer_diagnostic_pkey PRIMARY KEY (donation_alert_playback_id, code);

ALTER TABLE ONLY public.donation_alert_source
ADD CONSTRAINT donation_alert_source_pkey PRIMARY KEY (user_id, source);

ALTER TABLE ONLY public.donation
ADD CONSTRAINT donation_pkey PRIMARY KEY (donation_id);

ALTER TABLE ONLY public.donation
ADD CONSTRAINT donation_user_id_source_source_donation_id_key UNIQUE (user_id, source, source_donation_id);

ALTER TABLE ONLY public.donation_video_scan
ADD CONSTRAINT donation_video_scan_pkey PRIMARY KEY (donation_id);

ALTER TABLE ONLY public.donationalerts_connection
ADD CONSTRAINT donationalerts_connection_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY public.donationalerts_connection
ADD CONSTRAINT donationalerts_connection_source_user_id_key UNIQUE (source_user_id);

ALTER TABLE ONLY public.schema_migrations
ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);

ALTER TABLE ONLY public.streamlabs_connection
ADD CONSTRAINT streamlabs_connection_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY public.streamlabs_connection
ADD CONSTRAINT streamlabs_connection_source_user_id_key UNIQUE (source_user_id);

ALTER TABLE ONLY public."user"
ADD CONSTRAINT user_auth_user_id_key UNIQUE (auth_user_id);

ALTER TABLE ONLY public."user"
ADD CONSTRAINT user_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY public."user"
ADD CONSTRAINT user_slug_key UNIQUE (slug);

ALTER TABLE ONLY public.video
ADD CONSTRAINT video_donation_id_provider_provider_video_id_key UNIQUE (donation_id, provider, provider_video_id);

ALTER TABLE ONLY public.video_metadata_job
ADD CONSTRAINT video_metadata_job_pkey PRIMARY KEY (video_id);

ALTER TABLE ONLY public.video
ADD CONSTRAINT video_pkey PRIMARY KEY (video_id);

ALTER TABLE ONLY public.video_priority
ADD CONSTRAINT video_priority_pkey PRIMARY KEY (video_priority_id);

ALTER TABLE ONLY public.video_priority
ADD CONSTRAINT video_priority_user_id_label_key UNIQUE (user_id, label);

ALTER TABLE ONLY public.video_queue
ADD CONSTRAINT video_queue_pkey PRIMARY KEY (video_queue_id);

ALTER TABLE ONLY public.video_queue
ADD CONSTRAINT video_queue_user_id_label_key UNIQUE (user_id, label);

ALTER TABLE ONLY public.video_queue
ADD CONSTRAINT video_queue_video_queue_id_user_id_key UNIQUE (video_queue_id, user_id);

CREATE INDEX "auth_account_userId_idx" ON auth.auth_account USING btree ("userId");

CREATE INDEX "auth_session_userId_idx" ON auth.auth_session USING btree ("userId");

CREATE INDEX auth_verification_identifier_idx ON auth.auth_verification USING btree (identifier);

CREATE INDEX chat_moderation_action_user_occurred_idx ON public.chat_moderation_action USING btree (user_id, occurred_at DESC, chat_moderation_action_id DESC);

CREATE INDEX chat_oauth_attempt_expires_idx ON public.chat_oauth_attempt USING btree (expires_at);

CREATE INDEX chat_overlay_source_user_position_idx ON public.chat_overlay_source USING btree (user_id, "position");

CREATE INDEX chat_provider_connection_user_idx ON public.chat_provider_connection USING btree (user_id, connected_at);

CREATE INDEX chat_source_connection_idx ON public.chat_source USING btree (chat_provider_connection_id, "position");

CREATE INDEX chat_source_user_enabled_idx ON public.chat_source USING btree (user_id, "position") WHERE enabled;

CREATE INDEX donation_alert_playback_expiry_idx ON public.donation_alert_playback USING btree (expires_at) WHERE (
  status = any(ARRAY['preparing'::public.donation_alert_playback_status, 'pending'::public.donation_alert_playback_status])
);

CREATE UNIQUE INDEX donation_alert_playback_incoming_donation_idx ON public.donation_alert_playback USING btree (donation_id) WHERE (kind = 'incoming'::public.donation_alert_playback_kind);

CREATE INDEX donation_alert_playback_pending_idx ON public.donation_alert_playback USING btree (user_id, available_at, queue_sequence) WHERE (
  status = 'pending'::public.donation_alert_playback_status
);

CREATE UNIQUE INDEX donation_alert_playback_playing_user_idx ON public.donation_alert_playback USING btree (user_id) WHERE (status = 'playing'::public.donation_alert_playback_status);

CREATE INDEX donation_alert_playback_preparing_idx ON public.donation_alert_playback USING btree (available_at, preparation_lease_expires_at, queue_sequence) WHERE (
  status = 'preparing'::public.donation_alert_playback_status
);

CREATE INDEX donation_alert_playback_recent_idx ON public.donation_alert_playback USING btree (user_id, queue_sequence DESC);

CREATE INDEX donation_alert_playback_terminal_retention_idx ON public.donation_alert_playback USING btree (finished_at) WHERE (
  status
  = any(
    ARRAY[
      'completed'::public.donation_alert_playback_status,
      'skipped'::public.donation_alert_playback_status,
      'expired'::public.donation_alert_playback_status,
      'interrupted'::public.donation_alert_playback_status
    ]
  )
);

CREATE INDEX donation_alert_renderer_diagnostic_recent_idx ON public.donation_alert_renderer_diagnostic USING btree (user_id, occurred_at DESC);

CREATE INDEX donation_user_occurred_idx ON public.donation USING btree (user_id, occurred_at DESC, donation_id DESC);

CREATE INDEX donation_video_scan_available_idx ON public.donation_video_scan USING btree (available_at, lease_expires_at, donation_id) WHERE (completed_at IS NULL);

CREATE INDEX donation_videos_unparsed_idx ON public.donation USING btree (occurred_at) WHERE (videos_parsed_at IS NULL);

CREATE INDEX video_bookmarked_idx ON public.video USING btree (bookmarked_at DESC, video_id DESC) WHERE (bookmarked_at IS NOT NULL);

CREATE INDEX video_metadata_job_available_idx ON public.video_metadata_job USING btree (available_at, video_id) WHERE (completed_at IS NULL);

CREATE UNIQUE INDEX video_priority_default_idx ON public.video_priority USING btree (user_id) WHERE is_default;

CREATE UNIQUE INDEX video_queue_default_idx ON public.video_queue USING btree (user_id) WHERE is_default;

CREATE INDEX video_queue_idx ON public.video USING btree (video_queue_id, video_id DESC);

CREATE INDEX video_watched_idx ON public.video USING btree (watched_at DESC, video_id DESC) WHERE (watched_at IS NOT NULL);

CREATE TRIGGER enqueue_donation_video_scan AFTER INSERT ON public.donation FOR EACH ROW EXECUTE FUNCTION public.enqueue_donation_video_scan();

CREATE TRIGGER enqueue_video_metadata_job AFTER INSERT ON public.video FOR EACH ROW EXECUTE FUNCTION public.enqueue_video_metadata_job();

CREATE TRIGGER set_video_priority_id BEFORE INSERT OR UPDATE OF queue_amount,
start_seconds,
end_seconds,
duration_seconds,
donation_id,
user_id,
video_queue_id,
video_priority_id ON public.video FOR EACH ROW EXECUTE FUNCTION public.set_video_priority_id();

ALTER TABLE ONLY auth.auth_account
ADD CONSTRAINT "auth_account_userId_fkey" FOREIGN KEY ("userId") REFERENCES auth.auth_user (id) ON DELETE CASCADE;

ALTER TABLE ONLY auth.auth_session
ADD CONSTRAINT "auth_session_userId_fkey" FOREIGN KEY ("userId") REFERENCES auth.auth_user (id) ON DELETE CASCADE;

ALTER TABLE ONLY public.chat_moderation_action
ADD CONSTRAINT chat_moderation_action_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user" (user_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.chat_oauth_attempt
ADD CONSTRAINT chat_oauth_attempt_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user" (user_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.chat_overlay_source
ADD CONSTRAINT chat_overlay_source_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.chat_overlay (user_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.chat_overlay
ADD CONSTRAINT chat_overlay_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user" (user_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.chat_provider_ban
ADD CONSTRAINT chat_provider_ban_chat_source_id_fkey FOREIGN KEY (chat_source_id) REFERENCES public.chat_source (chat_source_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.chat_provider_connection
ADD CONSTRAINT chat_provider_connection_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user" (user_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.chat_source
ADD CONSTRAINT chat_source_chat_provider_connection_id_user_id_provider_fkey
  FOREIGN KEY (chat_provider_connection_id, user_id, provider) REFERENCES public.chat_provider_connection (chat_provider_connection_id, user_id, provider) ON DELETE CASCADE;

ALTER TABLE ONLY public.chat_source
ADD CONSTRAINT chat_source_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user" (user_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.donate_stream_connection
ADD CONSTRAINT donate_stream_connection_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user" (user_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.donation_alert_asset
ADD CONSTRAINT donation_alert_asset_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user" (user_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.donation_alert_configuration
ADD CONSTRAINT donation_alert_configuration_image_asset_id_user_id_fkey FOREIGN KEY (image_asset_id, user_id) REFERENCES public.donation_alert_asset (donation_alert_asset_id, user_id);

ALTER TABLE ONLY public.donation_alert_configuration
ADD CONSTRAINT donation_alert_configuration_sound_asset_id_user_id_fkey FOREIGN KEY (sound_asset_id, user_id) REFERENCES public.donation_alert_asset (donation_alert_asset_id, user_id);

ALTER TABLE ONLY public.donation_alert_configuration
ADD CONSTRAINT donation_alert_configuration_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user" (user_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.donation_alert_overlay
ADD CONSTRAINT donation_alert_overlay_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user" (user_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.donation_alert_playback
ADD CONSTRAINT donation_alert_playback_donation_id_fkey FOREIGN KEY (donation_id) REFERENCES public.donation (donation_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.donation_alert_playback
ADD CONSTRAINT donation_alert_playback_image_asset_id_user_id_fkey FOREIGN KEY (image_asset_id, user_id) REFERENCES public.donation_alert_asset (donation_alert_asset_id, user_id);

ALTER TABLE ONLY public.donation_alert_playback
ADD CONSTRAINT donation_alert_playback_sound_asset_id_user_id_fkey FOREIGN KEY (sound_asset_id, user_id) REFERENCES public.donation_alert_asset (donation_alert_asset_id, user_id);

ALTER TABLE ONLY public.donation_alert_playback
ADD CONSTRAINT donation_alert_playback_tts_asset_id_user_id_fkey FOREIGN KEY (tts_asset_id, user_id) REFERENCES public.donation_alert_asset (donation_alert_asset_id, user_id);

ALTER TABLE ONLY public.donation_alert_playback
ADD CONSTRAINT donation_alert_playback_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user" (user_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.donation_alert_player
ADD CONSTRAINT donation_alert_player_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user" (user_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.donation_alert_renderer_diagnostic
ADD CONSTRAINT donation_alert_renderer_diagn_donation_alert_playback_id_u_fkey
  FOREIGN KEY (donation_alert_playback_id, user_id) REFERENCES public.donation_alert_playback (donation_alert_playback_id, user_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.donation_alert_source
ADD CONSTRAINT donation_alert_source_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.donation_alert_configuration (user_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.donation
ADD CONSTRAINT donation_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user" (user_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.donation_video_scan
ADD CONSTRAINT donation_video_scan_donation_id_fkey FOREIGN KEY (donation_id) REFERENCES public.donation (donation_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.donationalerts_connection
ADD CONSTRAINT donationalerts_connection_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user" (user_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.streamlabs_connection
ADD CONSTRAINT streamlabs_connection_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user" (user_id) ON DELETE CASCADE;

ALTER TABLE ONLY public."user"
ADD CONSTRAINT user_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.auth_user (id);

ALTER TABLE ONLY public.video
ADD CONSTRAINT video_donation_id_fkey FOREIGN KEY (donation_id) REFERENCES public.donation (donation_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.video_metadata_job
ADD CONSTRAINT video_metadata_job_video_id_fkey FOREIGN KEY (video_id) REFERENCES public.video (video_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.video_priority
ADD CONSTRAINT video_priority_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user" (user_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.video_queue
ADD CONSTRAINT video_queue_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user" (user_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.video
ADD CONSTRAINT video_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user" (user_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.video
ADD CONSTRAINT video_video_priority_id_fkey FOREIGN KEY (video_priority_id) REFERENCES public.video_priority (video_priority_id);

ALTER TABLE ONLY public.video
ADD CONSTRAINT video_video_queue_id_fkey FOREIGN KEY (video_queue_id) REFERENCES public.video_queue (video_queue_id);

\unrestrict dbmate

INSERT INTO public.schema_migrations (version) VALUES
('20260909000000'),
('20260909195358'),
('20260910120000'),
('20260910180000'),
('20260913000000'),
('20260913144100');
