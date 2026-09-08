package videoingest

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"

	"github.com/lebedev-nikita/coldbrew/internal/youtube"
)

// BackfillTitles fills only missing titles. Re-running retries unavailable videos
// without rescanning donations or changing video timing, money or priorities.
func (store *Store) BackfillTitles(ctx context.Context, client *http.Client, apiKey string) error {
	cursor := ""
	failures := 0
	for {
		rows, err := store.pool.Query(ctx, `
   SELECT DISTINCT provider_video_id
   FROM video
   WHERE provider = 'youtube' AND title IS NULL AND provider_video_id > $1
   ORDER BY provider_video_id
   LIMIT 100
  `, cursor)
		if err != nil {
			return err
		}
		ids := make([]string, 0, 100)
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return err
			}
			ids = append(ids, id)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		if len(ids) == 0 {
			break
		}
		for _, id := range ids {
			title, err := youtube.GetTitle(ctx, client, apiKey, "https://www.youtube.com/watch?v="+url.QueryEscape(id))
			if err != nil {
				if ctx.Err() != nil {
					return ctx.Err()
				}
				failures++
				slog.Warn("video title unavailable", "provider_video_id", id, "error", err)
				continue
			}
			result, err := store.pool.Exec(ctx, `
    UPDATE video
    SET title = $2
    WHERE provider = 'youtube' AND provider_video_id = $1 AND title IS NULL
   `, id, title)
			if err != nil {
				return err
			}
			slog.Info("video title saved", "provider_video_id", id, "videos", result.RowsAffected())
		}
		cursor = ids[len(ids)-1]
	}
	if failures > 0 {
		return fmt.Errorf("could not fetch titles for %d videos; rerun to retry", failures)
	}
	return nil
}
