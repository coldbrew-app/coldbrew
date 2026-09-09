-- migrate:up
CREATE TABLE IF NOT EXISTS video_queue (
  video_queue_id serial  PRIMARY KEY,
  user_id        int     NOT NULL REFERENCES "user" (user_id) ON DELETE CASCADE,
  label          text    NOT NULL CHECK (char_length(trim(label)) BETWEEN 1 AND 64),
  is_default     boolean NOT NULL DEFAULT FALSE,
  UNIQUE (video_queue_id, user_id),
  UNIQUE (user_id, label)
);

CREATE UNIQUE INDEX IF NOT EXISTS video_queue_default_idx
ON video_queue (user_id)
WHERE is_default;

ALTER TABLE video ADD COLUMN IF NOT EXISTS video_queue_id int;

INSERT INTO video_queue (user_id, label, is_default)
SELECT user_id, 'Main' AS label, TRUE AS is_default
FROM "user"
ON CONFLICT (user_id) WHERE is_default DO NOTHING;

UPDATE video
SET video_queue_id = video_queue.video_queue_id
FROM video_queue
WHERE video_queue.user_id = coalesce(
  video.user_id,
  (
    SELECT donation.user_id
    FROM donation
    WHERE donation.donation_id = video.donation_id
  )
)
AND video_queue.is_default
AND video.video_queue_id IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'video_priority'
      AND column_name = 'video_queue_id'
  ) THEN
    ALTER TABLE video
      DROP CONSTRAINT IF EXISTS video_video_queue_id_video_priority_id_fkey;

    UPDATE video
    SET video_priority_id = CASE
      WHEN queue_amount IS NULL OR end_seconds IS NULL OR
           (duration_seconds IS NOT NULL AND start_seconds >= duration_seconds)
        THEN NULL
      ELSE (
        SELECT video_priority.video_priority_id
        FROM video_priority
        JOIN video_queue USING (video_queue_id)
        WHERE video_priority.user_id = coalesce(
            video.user_id,
            (SELECT donation.user_id
             FROM donation
             WHERE donation.donation_id = video.donation_id)
          )
          AND video_queue.is_default
          AND video_priority.min_price_per_minute <=
            video.queue_amount * 60 / (video.end_seconds - video.start_seconds)
        ORDER BY
          video_priority.min_price_per_minute DESC,
          video_priority.video_priority_id ASC
        LIMIT 1
      )
    END;

    DELETE FROM video_priority
    USING video_queue
    WHERE video_priority.video_queue_id = video_queue.video_queue_id
      AND NOT video_queue.is_default;

    DROP INDEX IF EXISTS video_priority_default_idx;
    ALTER TABLE video_priority DROP COLUMN video_queue_id;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'video_priority'::regclass
      AND conname = 'video_priority_user_id_label_key'
  ) THEN
    ALTER TABLE video_priority
      ADD CONSTRAINT video_priority_user_id_label_key UNIQUE (user_id, label);
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS video_priority_default_idx
ON video_priority (user_id)
WHERE is_default;

ALTER TABLE video ALTER COLUMN video_queue_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'video'::regclass
      AND conname = 'video_video_queue_id_fkey'
  ) THEN
    ALTER TABLE video
      ADD CONSTRAINT video_video_queue_id_fkey
      FOREIGN KEY (video_queue_id) REFERENCES video_queue (video_queue_id);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS video_queue_idx ON video (video_queue_id, video_id DESC);

CREATE OR REPLACE FUNCTION set_video_priority_id()
RETURNS trigger
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

DROP TRIGGER IF EXISTS set_video_priority_id ON video;

CREATE TRIGGER set_video_priority_id
BEFORE INSERT OR UPDATE OF queue_amount, start_seconds, end_seconds, duration_seconds, donation_id, user_id, video_queue_id, video_priority_id ON video
FOR EACH ROW
EXECUTE FUNCTION set_video_priority_id();

-- migrate:down
DO $$
BEGIN
  RAISE EXCEPTION 'video queues cannot be rolled back without discarding queue assignments';
END;
$$;
