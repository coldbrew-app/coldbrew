-- migrate:up
ALTER TYPE donation_source ADD VALUE 'tourniquet';

CREATE DOMAIN donation_amount AS numeric(38, 18) CHECK (value >= 0);
CREATE DOMAIN donation_asset AS varchar(32) CHECK (
  value ~ '^[A-Z0-9][-A-Z0-9 ._()/+]{0,31}$'
);

ALTER TABLE donation
ALTER COLUMN amount TYPE donation_amount USING amount::numeric,
ALTER COLUMN currency TYPE donation_asset USING trim(currency::text);

ALTER TABLE donation_alert_playback
ALTER COLUMN amount TYPE donation_amount USING amount::numeric,
ALTER COLUMN currency TYPE donation_asset USING trim(currency::text);

CREATE TABLE tourniquet_connection (
  user_id      int     PRIMARY KEY REFERENCES "user" (user_id) ON DELETE CASCADE,
  widget_token text    NOT NULL UNIQUE CHECK (widget_token ~ '^[A-Za-z0-9]{16,200}$'),
  connected_at js_date NOT NULL DEFAULT now(),
  updated_at   js_date NOT NULL DEFAULT now()
);

-- migrate:down
DO $$
BEGIN
  RAISE EXCEPTION 'Tourniquet cannot be rolled back without discarding donations and connection credentials';
END;
$$;
