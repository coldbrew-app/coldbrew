package alerts

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/lebedev-nikita/coldbrew/internal/observability"
)

const telegramMessageLimit = 4096

type Telegram struct {
	token      string
	chatID     string
	httpClient *http.Client
	baseURL    string
}

func NewTelegram(token, chatID string, httpClient *http.Client) *Telegram {
	return &Telegram{token: token, chatID: chatID, httpClient: httpClient, baseURL: "https://api.telegram.org"}
}

type SendError struct {
	Status     int
	RetryAfter time.Duration
	Detail     string
}

func (err *SendError) Error() string {
	return fmt.Sprintf("Telegram returned HTTP %d: %s", err.Status, err.Detail)
}

func (telegram *Telegram) Send(ctx context.Context, event observability.Event) error {
	return telegram.call(ctx, "sendMessage", map[string]any{
		"chat_id": telegram.chatID,
		"text":    truncate(format(event), telegramMessageLimit),
	}, nil)
}

func (telegram *Telegram) call(ctx context.Context, method string, input any, output any) error {
	requestBody, err := json.Marshal(input)
	if err != nil {
		return fmt.Errorf("encode Telegram request: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost,
		telegram.baseURL+"/bot"+telegram.token+"/"+method, bytes.NewReader(requestBody))
	if err != nil {
		return fmt.Errorf("create Telegram request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := telegram.httpClient.Do(request)
	if err != nil {
		// net/http errors contain the request URL, including the bot token.
		return errors.New("Telegram request failed: " + strings.ReplaceAll(err.Error(), telegram.token, "[REDACTED]"))
	}
	defer response.Body.Close()
	var body struct {
		OK          bool            `json:"ok"`
		Result      json.RawMessage `json:"result"`
		ErrorCode   int             `json:"error_code"`
		Description string          `json:"description"`
		Parameters  struct {
			RetryAfter int `json:"retry_after"`
		} `json:"parameters"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		return fmt.Errorf("decode Telegram response: %w", err)
	}
	if response.StatusCode >= 200 && response.StatusCode < 300 && body.OK {
		if output != nil {
			return json.Unmarshal(body.Result, output)
		}
		return nil
	}
	status := response.StatusCode
	if body.ErrorCode != 0 {
		status = body.ErrorCode
	}
	return &SendError{
		Status: status, RetryAfter: time.Duration(body.Parameters.RetryAfter) * time.Second,
		Detail: body.Description,
	}
}

// RunCommands serves /myid independently of the operational log destination.
// Run one polling process per bot token.
func (telegram *Telegram) RunCommands(ctx context.Context) error {
	var identity struct {
		Username string `json:"username"`
	}
	for {
		err := telegram.call(ctx, "getMe", struct{}{}, &identity)
		if err == nil {
			break
		}
		if permanent(err) {
			return fmt.Errorf("authorize Telegram bot: %w", err)
		}
		if !waitRetry(ctx, err) {
			return nil
		}
	}
	var offset int64
	for ctx.Err() == nil {
		var updates []struct {
			ID      int64 `json:"update_id"`
			Message *struct {
				Text string `json:"text"`
				Chat struct {
					ID int64 `json:"id"`
				} `json:"chat"`
			} `json:"message"`
		}
		err := telegram.call(ctx, "getUpdates", map[string]any{
			"offset": offset, "timeout": 25, "allowed_updates": []string{"message"},
		}, &updates)
		if err != nil {
			if permanent(err) {
				return fmt.Errorf("receive Telegram commands: %w", err)
			}
			if !waitRetry(ctx, err) {
				return nil
			}
			continue
		}
		for _, update := range updates {
			if ctx.Err() != nil {
				return nil
			}
			if update.Message != nil {
				words := strings.Fields(update.Message.Text)
				if len(words) > 0 && (words[0] == "/myid" || strings.EqualFold(words[0], "/myid@"+identity.Username)) {
					chatID := strconv.FormatInt(update.Message.Chat.ID, 10)
					for {
						err := telegram.call(ctx, "sendMessage", map[string]string{"chat_id": chatID, "text": chatID}, nil)
						if err == nil {
							break
						}
						var sendErr *SendError
						if errors.As(err, &sendErr) && sendErr.Status >= 400 && sendErr.Status < 500 && sendErr.Status != 429 {
							slog.Warn("Telegram command reply rejected", "error", err)
							break
						}
						if !waitRetry(ctx, err) {
							return nil
						}
					}
				}
			}
			offset = update.ID + 1
		}
	}
	return nil
}

func permanent(err error) bool {
	var apiErr *SendError
	return errors.As(err, &apiErr) && apiErr.Status >= 400 && apiErr.Status < 500 && apiErr.Status != http.StatusTooManyRequests
}

func waitRetry(ctx context.Context, err error) bool {
	if ctx.Err() != nil {
		return false
	}
	slog.Warn("Telegram command request failed", "error", err)
	delay := 5 * time.Second
	var apiErr *SendError
	if errors.As(err, &apiErr) && apiErr.RetryAfter > delay {
		delay = apiErr.RetryAfter
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func format(event observability.Event) string {
	var result strings.Builder
	result.WriteString(strings.ToUpper(event.Level))
	result.WriteString(" · ")
	result.WriteString(event.Service)
	result.WriteString(" · ")
	result.WriteString(event.Environment)
	result.WriteString("\n")
	result.WriteString(event.Message)
	result.WriteString("\n")
	result.WriteString(event.OccurredAt.Format(time.RFC3339))
	if len(event.Fields) > 0 {
		fields, _ := json.MarshalIndent(event.Fields, "", "  ")
		result.WriteString("\n\n")
		result.Write(fields)
	}
	return result.String()
}

func truncate(value string, limit int) string {
	if utf8.RuneCountInString(value) <= limit {
		return value
	}
	runes := []rune(value)
	omitted := len(runes) - limit
	suffix := "\n… " + strconv.Itoa(omitted) + " characters omitted"
	suffixRunes := []rune(suffix)
	return string(runes[:limit-len(suffixRunes)]) + suffix
}
