package donationalert

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const (
	DefaultTTSVoice   = "ru"
	MaxTTSTextRunes   = 500
	MaxTTSTextBytes   = 4 << 10
	maxTTSWaveBytes   = MaxAlertSoundBytes
	ttsCommandTimeout = 10 * time.Second
)

type SynthesisErrorCode string

const (
	SynthesisInvalidText      SynthesisErrorCode = "invalid_text"
	SynthesisUnsupportedVoice SynthesisErrorCode = "unsupported_voice"
	SynthesisToolUnavailable  SynthesisErrorCode = "tool_unavailable"
	SynthesisTimedOut         SynthesisErrorCode = "timed_out"
	SynthesisFailed           SynthesisErrorCode = "failed"
)

// SynthesisError is safe for the preparation worker to treat as a recoverable
// loss of TTS. The visual alert and regular sound should still be queued.
type SynthesisError struct {
	Code SynthesisErrorCode
	Err  error
}

func (e *SynthesisError) Error() string {
	if e.Err == nil {
		return "alert speech synthesis " + string(e.Code)
	}
	return "alert speech synthesis " + string(e.Code) + ": " + e.Err.Error()
}

func (e *SynthesisError) Unwrap() error { return e.Err }

func (e *SynthesisError) FallbackSafe() bool { return true }

type Synthesizer interface {
	Synthesize(context.Context, string, string) (Media, error)
}

type ESpeakSynthesizer struct {
	runner    commandRunner
	processor *FFmpegMediaProcessor
	timeout   time.Duration
}

func NewESpeakSynthesizer() Synthesizer {
	runner := newExecCommandRunner()
	return &ESpeakSynthesizer{runner: runner, processor: newFFmpegMediaProcessor(runner), timeout: ttsCommandTimeout}
}

func newESpeakSynthesizer(runner commandRunner) *ESpeakSynthesizer {
	return &ESpeakSynthesizer{runner: runner, processor: newFFmpegMediaProcessor(runner), timeout: ttsCommandTimeout}
}

func (synthesizer *ESpeakSynthesizer) Synthesize(ctx context.Context, text, voice string) (Media, error) {
	normalized, err := normalizeTTSText(text)
	if err != nil {
		return Media{}, err
	}
	if voice == "" {
		voice = DefaultTTSVoice
	}
	if voice != DefaultTTSVoice {
		return Media{}, &SynthesisError{Code: SynthesisUnsupportedVoice}
	}

	commandCtx, cancel := context.WithTimeout(ctx, synthesizer.timeout)
	wave, err := synthesizer.runner.Run(commandCtx, commandSpec{
		name:           "espeak-ng",
		args:           []string{"-b", "1", "-v", voice, "-s", "165", "--stdin", "--stdout"},
		input:          []byte(normalized),
		maxOutputBytes: maxTTSWaveBytes,
	})
	if err != nil {
		commandErr := synthesisCommandError(commandCtx, err)
		cancel()
		return Media{}, commandErr
	}
	cancel()
	if len(wave) < 12 || string(wave[:4]) != "RIFF" || string(wave[8:12]) != "WAVE" {
		return Media{}, &SynthesisError{Code: SynthesisFailed, Err: errors.New("espeak-ng returned invalid WAV output")}
	}

	media, err := synthesizer.processor.PrepareSound(ctx, wave)
	if err != nil {
		var mediaError *MediaError
		if errors.As(err, &mediaError) {
			switch mediaError.Code {
			case MediaToolUnavailable:
				return Media{}, &SynthesisError{Code: SynthesisToolUnavailable, Err: err}
			case MediaProcessingTimedOut:
				return Media{}, &SynthesisError{Code: SynthesisTimedOut, Err: err}
			case MediaTooLarge, MediaUnsupported, MediaInvalid, MediaDimensions, MediaDuration,
				MediaContainsVideo, MediaProcessingFailed:
				return Media{}, &SynthesisError{Code: SynthesisFailed, Err: err}
			}
		}
		return Media{}, &SynthesisError{Code: SynthesisFailed, Err: err}
	}
	return media, nil
}

func normalizeTTSText(text string) (string, error) {
	if len(text) > MaxTTSTextBytes {
		return "", &SynthesisError{Code: SynthesisInvalidText, Err: errors.New("text exceeds input limit")}
	}
	if !utf8.ValidString(text) {
		return "", &SynthesisError{Code: SynthesisInvalidText, Err: errors.New("text is not valid UTF-8")}
	}
	text = strings.Join(strings.Fields(text), " ")
	if text == "" {
		return "", &SynthesisError{Code: SynthesisInvalidText, Err: errors.New("text is empty")}
	}
	if len(text) > MaxTTSTextBytes || utf8.RuneCountInString(text) > MaxTTSTextRunes {
		return "", &SynthesisError{Code: SynthesisInvalidText, Err: errors.New("text exceeds limit")}
	}
	for _, character := range text {
		if unicode.IsControl(character) {
			return "", &SynthesisError{Code: SynthesisInvalidText, Err: fmt.Errorf("text contains control character U+%04X", character)}
		}
	}
	return text, nil
}

func synthesisCommandError(ctx context.Context, err error) error {
	if errors.Is(ctx.Err(), context.Canceled) {
		return context.Canceled
	}
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return &SynthesisError{Code: SynthesisTimedOut, Err: err}
	}
	if commandUnavailable(err) {
		return &SynthesisError{Code: SynthesisToolUnavailable, Err: err}
	}
	return &SynthesisError{Code: SynthesisFailed, Err: err}
}
