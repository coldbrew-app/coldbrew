package videoingest

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/lebedev-nikita/coldbrew/internal/youtube"
)

type YouTubeClient struct{ client *http.Client }

func NewYouTubeClient(client *http.Client) *YouTubeClient { return &YouTubeClient{client: client} }

func (client *YouTubeClient) Timing(ctx context.Context, rawURL string) (youtube.Timing, error) {
	timing, err := youtube.GetTiming(ctx, client.client, rawURL, nil)
	if err != nil {
		return youtube.Timing{}, err
	}
	if timing.Title == "" {
		title, titleErr := youtube.GetTitle(ctx, client.client, rawURL)
		if titleErr != nil {
			if ctx.Err() != nil {
				return youtube.Timing{}, ctx.Err()
			}
			slog.Warn("video title unavailable", "url", rawURL, "error", titleErr)
		} else {
			timing.Title = title
		}
	}
	return timing, nil
}
