-- Run once before applying db/schema.sql to an existing installation.
-- Stop application writers for the migration and schema application.
BEGIN;

CREATE TABLE IF NOT EXISTS video_queue (
  video_queue_id serial  PRIMARY KEY,
  user_id        int     NOT NULL REFERENCES "user" (user_id) ON DELETE CASCADE,
  label          text    NOT NULL CHECK (char_length(trim(label)) BETWEEN 1 AND 64),
  is_default     boolean NOT NULL DEFAULT false,
  UNIQUE (video_queue_id, user_id),
  UNIQUE (user_id, label)
);

CREATE UNIQUE INDEX IF NOT EXISTS video_queue_default_idx
  ON video_queue (user_id) WHERE is_default;

ALTER TABLE video_priority ADD COLUMN IF NOT EXISTS video_queue_id int;
ALTER TABLE video ADD COLUMN IF NOT EXISTS video_queue_id int;

INSERT INTO video_queue (user_id, label, is_default)
SELECT user_id, 'Main', true FROM "user"
ON CONFLICT (user_id) WHERE is_default DO NOTHING;

UPDATE video_priority
SET video_queue_id = video_queue.video_queue_id
FROM video_queue
WHERE video_priority.user_id = video_queue.user_id
  AND video_queue.is_default AND video_priority.video_queue_id IS NULL;

UPDATE video
SET video_queue_id = video_queue.video_queue_id
FROM video_queue
WHERE video_queue.user_id = coalesce(video.user_id,
    (SELECT user_id FROM donation WHERE donation_id = video.donation_id))
  AND video_queue.is_default AND video.video_queue_id IS NULL;

-- All priorities, amounts, timing, watched/bookmarked state and video IDs survive.
COMMIT;
