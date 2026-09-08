package videoingest

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

type metadataTransport func(*http.Request) (*http.Response, error)

func (transport metadataTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	return transport(request)
}

func TestMetadataFailureThenRecovery(t *testing.T) {
	for _, test := range []struct {
		name     string
		status   int
		body     string
		terminal bool
	}{
		{"missing duration", 200, `<html>no metadata</html>`, false},
		{"rate limited", 429, ``, false},
		{"server failure", 503, ``, false},
		{"forbidden", 403, ``, false},
		{"transport", 0, ``, false},
		{"removed", 200, `{"playabilityStatus":{"status":"ERROR","reason":"This video has been removed by the uploader"}}`, true},
		{"bot challenge", 200, `{"playabilityStatus":{"status":"LOGIN_REQUIRED","reason":"Sign in to confirm you are not a bot"}}`, false},
		{"private", 200, `{"playabilityStatus":{"status":"LOGIN_REQUIRED","reason":"This video is private."}}`, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			store, pool := newIntegrationStore(t)
			ctx := context.Background()
			seedDonation(t, pool, 1101)
			_, err := pool.Exec(ctx, `UPDATE donation SET message = $1 WHERE donation_id = 1101`, "Посмотри видео, пожалуйста: https://www.youtube.com/watch?v=_JXL6Fn99l8&t=13s")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := NewWorker(store, DefaultConfig()).ProcessNext(ctx); err != nil {
				t.Fatal(err)
			}
			var videoID int64
			var duration *int
			var parsed bool
			if err := pool.QueryRow(ctx, `SELECT video_id, duration_seconds, videos_parsed_at IS NOT NULL FROM video JOIN donation USING (donation_id)`).Scan(&videoID, &duration, &parsed); err != nil {
				t.Fatal(err)
			}
			if duration != nil || !parsed {
				t.Fatalf("duration=%v parsed=%v", duration, parsed)
			}
			client := &http.Client{Transport: metadataTransport(func(request *http.Request) (*http.Response, error) {
				if test.status == 0 && request.URL.Path != "/oembed" {
					return nil, errors.New("connection reset")
				}
				status, body := test.status, test.body
				if request.URL.Path == "/oembed" {
					status, body = 200, `{"title":"Independent title"}`
				}
				return &http.Response{StatusCode: status, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(body))}, nil
			})}
			if worked, err := store.processMetadata(ctx, client); err != nil || !worked {
				t.Fatalf("worked=%v err=%v", worked, err)
			}
			var completed bool
			var code string
			var available time.Time
			var title string
			if err := pool.QueryRow(ctx, `SELECT completed_at IS NOT NULL, last_error_code, available_at, title FROM video_metadata_job JOIN video USING (video_id)`).Scan(&completed, &code, &available, &title); err != nil {
				t.Fatal(err)
			}
			if completed != test.terminal || code == "" || title != "Independent title" || !available.After(time.Now()) {
				t.Fatalf("completed=%v code=%s available=%s title=%s", completed, code, available, title)
			}
			// Model owner retry and a user edit while the HTTP request is in flight.
			// js_date rounds to milliseconds, so now() can round into the future.
			// Make the retry unambiguously due without depending on runner speed.
			_, err = pool.Exec(ctx, `UPDATE video_metadata_job SET completed_at = NULL, available_at = now() - interval '1 second'`)
			if err != nil {
				t.Fatal(err)
			}
			client.Transport = metadataTransport(func(*http.Request) (*http.Response, error) {
				if _, err := pool.Exec(ctx, `UPDATE video SET start_seconds = 10, end_seconds = 70`); err != nil {
					return nil, err
				}
				return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`{"videoDetails":{"lengthSeconds":"7260","title":"Provider title"}}`))}, nil
			})
			if worked, err := store.processMetadata(ctx, client); err != nil || !worked {
				t.Fatalf("recovery worked=%v err=%v", worked, err)
			}
			var count, end, attempts int
			if err := pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM video), duration_seconds, end_seconds, attempts, completed_at IS NOT NULL FROM video JOIN video_metadata_job USING (video_id) WHERE video_id = $1`, videoID).Scan(&count, &duration, &end, &attempts, &completed); err != nil {
				t.Fatal(err)
			}
			if count != 1 || duration == nil || *duration != 7260 || end != 70 || attempts != 2 || !completed {
				t.Fatalf("count=%d duration=%v end=%d attempts=%d completed=%v", count, duration, end, attempts, completed)
			}
		})
	}
}

func TestMetadataLeaseFence(t *testing.T) {
	store, pool := newIntegrationStore(t)
	ctx := context.Background()
	seedDonation(t, pool, 1)
	if _, err := pool.Exec(ctx, `INSERT INTO video (donation_id, provider, provider_video_id, url, start_seconds) VALUES (1, 'youtube', '_JXL6Fn99l8', 'https://youtu.be/_JXL6Fn99l8', 0)`); err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Transport: metadataTransport(func(*http.Request) (*http.Response, error) {
		// Simulate a new owner reclaiming an expired lease before the old HTTP
		// request returns. Its generation must fence out the stale completion.
		if _, err := pool.Exec(ctx, `UPDATE video_metadata_job SET generation = generation + 1, lease_expires_at = now() + interval '2 minutes'`); err != nil {
			return nil, err
		}
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`{"videoDetails":{"lengthSeconds":"100","title":"Stale title"}}`))}, nil
	})}
	if _, err := store.processMetadata(ctx, client); err != nil {
		t.Fatal(err)
	}
	var unchanged bool
	if err := pool.QueryRow(ctx, `SELECT duration_seconds IS NULL AND title IS NULL AND completed_at IS NULL FROM video JOIN video_metadata_job USING (video_id)`).Scan(&unchanged); err != nil {
		t.Fatal(err)
	}
	if !unchanged {
		t.Fatal("stale worker committed metadata")
	}
	if worked, err := store.processMetadata(ctx, client); err != nil || worked {
		t.Fatalf("active lease was claimed: %v %v", worked, err)
	}
}

func TestOpenEndResolvesAndAssignsPriority(t *testing.T) {
	store, pool := newIntegrationStore(t)
	ctx := context.Background()
	seedDonation(t, pool, 1)
	if _, err := pool.Exec(ctx, `INSERT INTO video (donation_id, provider, provider_video_id, url, queue_amount, start_seconds) VALUES (1, 'youtube', '_JXL6Fn99l8', 'https://youtu.be/_JXL6Fn99l8', 10, 0)`); err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Transport: metadataTransport(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`{"videoDetails":{"lengthSeconds":"100","title":"Title"}}`))}, nil
	})}
	if _, err := store.processMetadata(ctx, client); err != nil {
		t.Fatal(err)
	}
	var assigned bool
	if err := pool.QueryRow(ctx, `SELECT end_seconds = 100 AND duration_seconds = 100 AND video_priority_id IS NOT NULL FROM video`).Scan(&assigned); err != nil {
		t.Fatal(err)
	}
	if !assigned {
		t.Fatal("open end was not resolved and assigned")
	}
}
