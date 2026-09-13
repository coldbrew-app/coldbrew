package donationalert

import (
	"context"
	"errors"
	"os/exec"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

func TestESpeakSynthesizerUsesBoundedPlainUTF8Pipeline(t *testing.T) {
	runner := &recordingCommandRunner{results: []commandResult{
		{output: wavSignature()},
		{output: []byte(`{"streams":[{"codec_type":"audio","codec_name":"pcm_s16le"}],"format":{"duration":"1.5"}}`)},
		{output: []byte("OggSspeech")},
	}}
	media, err := newESpeakSynthesizer(runner).Synthesize(
		context.Background(),
		"  Спасибо\n\tза донат, $(touch /tmp/no)!  ",
		"",
	)
	if err != nil {
		t.Fatal(err)
	}
	if media.MIMEType != "audio/ogg" || media.DurationMS != 1500 || string(media.Content) != "OggSspeech" {
		t.Fatalf("unexpected media: %#v", media)
	}
	if len(runner.calls) != 3 {
		t.Fatalf("calls = %#v", runner.calls)
	}
	espeak := runner.calls[0]
	if espeak.name != "espeak-ng" || strings.Join(espeak.args, " ") != "-b 1 -v ru -s 165 --stdin --stdout" {
		t.Fatalf("espeak command = %#v", espeak)
	}
	if string(espeak.input) != "Спасибо за донат, $(touch /tmp/no)!" {
		t.Fatalf("stdin = %q", espeak.input)
	}
	if espeak.maxOutputBytes != maxTTSWaveBytes {
		t.Fatalf("max output = %d", espeak.maxOutputBytes)
	}
	if runner.calls[1].name != "ffprobe" || runner.calls[2].name != "ffmpeg" {
		t.Fatalf("pipeline = %#v", runner.calls)
	}
}

func TestESpeakSynthesizerRejectsUnsupportedVoiceBeforeExecution(t *testing.T) {
	runner := &recordingCommandRunner{}
	_, err := newESpeakSynthesizer(runner).Synthesize(context.Background(), "Привет", "en")
	assertSynthesisError(t, err, SynthesisUnsupportedVoice)
	if len(runner.calls) != 0 {
		t.Fatalf("unexpected calls: %#v", runner.calls)
	}
}

func TestESpeakSynthesizerRejectsInvalidTextBeforeExecution(t *testing.T) {
	invalidUTF8 := string([]byte{0xff, 0xfe})
	tests := []struct {
		name string
		text string
	}{
		{name: "empty", text: " \n\t "},
		{name: "invalid utf8", text: invalidUTF8},
		{name: "control character", text: "hello\x00world"},
		{name: "too many runes", text: strings.Repeat("я", MaxTTSTextRunes+1)},
		{name: "too many bytes", text: strings.Repeat("界", MaxTTSTextBytes/utf8.RuneLen('界')+1)},
		{name: "oversized raw whitespace", text: strings.Repeat(" ", MaxTTSTextBytes) + "a"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			runner := &recordingCommandRunner{}
			_, err := newESpeakSynthesizer(runner).Synthesize(context.Background(), test.text, DefaultTTSVoice)
			assertSynthesisError(t, err, SynthesisInvalidText)
			if len(runner.calls) != 0 {
				t.Fatalf("unexpected calls: %#v", runner.calls)
			}
		})
	}
}

func TestESpeakSynthesizerClassifiesMissingBinary(t *testing.T) {
	runner := &recordingCommandRunner{results: []commandResult{{err: &exec.Error{Name: "espeak-ng", Err: exec.ErrNotFound}}}}
	_, err := newESpeakSynthesizer(runner).Synthesize(context.Background(), "Спасибо", DefaultTTSVoice)
	assertSynthesisError(t, err, SynthesisToolUnavailable)
}

func TestESpeakSynthesizerTimesOut(t *testing.T) {
	runner := &recordingCommandRunner{run: func(ctx context.Context, _ commandSpec) ([]byte, error) {
		<-ctx.Done()
		return nil, ctx.Err()
	}}
	synthesizer := newESpeakSynthesizer(runner)
	synthesizer.timeout = time.Millisecond
	_, err := synthesizer.Synthesize(context.Background(), "Спасибо", DefaultTTSVoice)
	assertSynthesisError(t, err, SynthesisTimedOut)
}

func TestESpeakSynthesizerUsesSeparateSpeechAndMediaDeadlines(t *testing.T) {
	runner := &recordingCommandRunner{run: func(ctx context.Context, spec commandSpec) ([]byte, error) {
		var output []byte
		delay := 30 * time.Millisecond
		switch spec.name {
		case "espeak-ng":
			output = wavSignature()
		case "ffprobe":
			output = []byte(`{"streams":[{"codec_type":"audio","codec_name":"pcm_s16le"}],"format":{"duration":"1"}}`)
			delay = 70 * time.Millisecond
		case "ffmpeg":
			return []byte("OggSspeech"), nil
		default:
			return nil, errors.New("unexpected command")
		}
		timer := time.NewTimer(delay)
		defer timer.Stop()
		select {
		case <-timer.C:
			return output, nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}}
	synthesizer := newESpeakSynthesizer(runner)
	synthesizer.timeout = 80 * time.Millisecond
	media, err := synthesizer.Synthesize(context.Background(), "Спасибо", DefaultTTSVoice)
	if err != nil {
		t.Fatal(err)
	}
	if string(media.Content) != "OggSspeech" {
		t.Fatalf("unexpected media: %#v", media)
	}
}

func TestESpeakSynthesizerTreatsTranscodeFailureAsFallbackSafe(t *testing.T) {
	runner := &recordingCommandRunner{results: []commandResult{
		{output: wavSignature()},
		{output: []byte(`{"streams":[{"codec_type":"audio","codec_name":"pcm_s16le"}],"format":{"duration":"1"}}`)},
		{err: errors.New("encoder failed")},
	}}
	_, err := newESpeakSynthesizer(runner).Synthesize(context.Background(), "Спасибо", DefaultTTSVoice)
	assertSynthesisError(t, err, SynthesisFailed)
}

func TestESpeakSynthesizerRejectsInvalidWaveOutput(t *testing.T) {
	runner := &recordingCommandRunner{results: []commandResult{{output: []byte("not a wave")}}}
	_, err := newESpeakSynthesizer(runner).Synthesize(context.Background(), "Спасибо", DefaultTTSVoice)
	assertSynthesisError(t, err, SynthesisFailed)
}

func assertSynthesisError(t *testing.T, err error, code SynthesisErrorCode) {
	t.Helper()
	var synthesisError *SynthesisError
	if !errors.As(err, &synthesisError) {
		t.Fatalf("expected SynthesisError, got %T: %v", err, err)
	}
	if synthesisError.Code != code || !synthesisError.FallbackSafe() {
		t.Fatalf("error = %#v, fallbackSafe=%v", synthesisError, synthesisError.FallbackSafe())
	}
}
