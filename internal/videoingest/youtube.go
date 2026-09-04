package videoingest

import (
	"context"
	"net/http"

	"github.com/lebedev-nikita/coldbrew/internal/youtube"
)

type YouTubeClient struct{ client *http.Client }

func NewYouTubeClient(client *http.Client) *YouTubeClient { return &YouTubeClient{client: client} }

func (client *YouTubeClient) Timing(ctx context.Context, rawURL string) (youtube.Timing, error) {
	return youtube.GetTiming(ctx, client.client, rawURL, nil)
}
