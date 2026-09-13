package donationalert

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"image"
	"image/color"
	"image/gif"
	"image/png"
	"os"
	"os/exec"
	"slices"
	"strings"
	"testing"
	"time"
)

type commandResult struct {
	output []byte
	err    error
}

type recordingCommandRunner struct {
	calls   []commandSpec
	results []commandResult
	run     func(context.Context, commandSpec) ([]byte, error)
}

func (runner *recordingCommandRunner) Run(ctx context.Context, spec commandSpec) ([]byte, error) {
	runner.calls = append(runner.calls, commandSpec{
		name:           spec.name,
		args:           slices.Clone(spec.args),
		input:          slices.Clone(spec.input),
		maxOutputBytes: spec.maxOutputBytes,
	})
	if runner.run != nil {
		return runner.run(ctx, spec)
	}
	if len(runner.results) == 0 {
		return nil, errors.New("unexpected command")
	}
	result := runner.results[0]
	runner.results = runner.results[1:]
	return slices.Clone(result.output), result.err
}

func TestPrepareImageAcceptsSupportedSignatures(t *testing.T) {
	tests := []struct {
		name     string
		content  []byte
		codec    string
		mimeType string
	}{
		{name: "png", content: append([]byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}, 0), codec: "png", mimeType: "image/png"},
		{name: "jpeg", content: []byte{0xff, 0xd8, 0xff, 0x00}, codec: "mjpeg", mimeType: "image/jpeg"},
		{name: "gif", content: []byte("GIF89a!"), codec: "gif", mimeType: "image/gif"},
		{name: "webp", content: []byte("RIFF0000WEBP!"), codec: "webp", mimeType: "image/webp"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			runner := &recordingCommandRunner{results: []commandResult{
				{output: []byte(`{"streams":[{"codec_type":"video","codec_name":"` + test.codec + `","width":1280,"height":720}],"format":{}}`)},
				{output: []byte{0}},
			}}
			media, err := newFFmpegMediaProcessor(runner).PrepareImage(context.Background(), test.content)
			if err != nil {
				t.Fatal(err)
			}
			if media.MIMEType != test.mimeType || media.Width != 1280 || media.Height != 720 || !slices.Equal(media.Content, test.content) {
				t.Fatalf("unexpected media: %#v", media)
			}
			if len(runner.calls) != 2 || runner.calls[0].name != "ffprobe" || runner.calls[1].name != "ffmpeg" {
				t.Fatalf("calls = %#v", runner.calls)
			}
			decodeArgs := strings.Join(runner.calls[1].args, " ")
			for _, required := range []string{"-xerror", "-threads 1", "-map 0:v:0", "scale=1:1:flags=neighbor,format=gray", "-fps_mode passthrough", "-f rawvideo", "pipe:1"} {
				if !strings.Contains(decodeArgs, required) {
					t.Errorf("ffmpeg args %q do not contain %q", decodeArgs, required)
				}
			}
		})
	}
}

func TestPrepareImageRejectsInvalidUploads(t *testing.T) {
	tests := []struct {
		name    string
		content []byte
		probe   string
		code    MediaErrorCode
	}{
		{name: "empty", code: MediaInvalid},
		{name: "unsupported signature", content: []byte("<svg></svg>"), code: MediaUnsupported},
		{name: "spoofed codec", content: pngSignature(), probe: `{"streams":[{"codec_type":"video","codec_name":"gif","width":1,"height":1}]}`, code: MediaInvalid},
		{name: "audio disguised as image", content: pngSignature(), probe: `{"streams":[{"codec_type":"audio","codec_name":"mp3"}]}`, code: MediaInvalid},
		{name: "too wide", content: pngSignature(), probe: `{"streams":[{"codec_type":"video","codec_name":"png","width":4097,"height":1}]}`, code: MediaDimensions},
		{name: "too many pixels", content: pngSignature(), probe: `{"streams":[{"codec_type":"video","codec_name":"png","width":4096,"height":4096}]}`, code: MediaDimensions},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			runner := &recordingCommandRunner{}
			if test.probe != "" {
				runner.results = []commandResult{{output: []byte(test.probe)}}
			}
			_, err := newFFmpegMediaProcessor(runner).PrepareImage(context.Background(), test.content)
			assertMediaError(t, err, test.code, true)
		})
	}
}

func TestPrepareImageRejectsOversizedInputBeforeRunningTools(t *testing.T) {
	runner := &recordingCommandRunner{}
	_, err := newFFmpegMediaProcessor(runner).PrepareImage(context.Background(), make([]byte, MaxAlertImageBytes+1))
	assertMediaError(t, err, MediaTooLarge, true)
	if len(runner.calls) != 0 {
		t.Fatalf("unexpected calls: %#v", runner.calls)
	}
}

func TestPrepareImageRejectsContentThatCannotBeDecoded(t *testing.T) {
	runner := &recordingCommandRunner{results: []commandResult{
		{output: []byte(`{"streams":[{"codec_type":"video","codec_name":"png","width":1280,"height":720}]}`)},
		{err: errors.New("decoder rejected image")},
	}}
	_, err := newFFmpegMediaProcessor(runner).PrepareImage(context.Background(), pngSignature())
	assertMediaError(t, err, MediaInvalid, true)
}

func TestPrepareImageBoundsAnimationFramesAndDecodedWork(t *testing.T) {
	if got := imageFrameLimit(800, 600); got != maxAlertImageFrames {
		t.Fatalf("ordinary image frame limit = %d, want %d", got, maxAlertImageFrames)
	}
	if got := imageFrameLimit(4000, 4000); got != 15 {
		t.Fatalf("large image frame limit = %d, want 15", got)
	}

	runner := &recordingCommandRunner{results: []commandResult{
		{output: []byte(`{"streams":[{"codec_type":"video","codec_name":"png","width":800,"height":600}]}`)},
		{output: make([]byte, maxAlertImageFrames+1)},
	}}
	_, err := newFFmpegMediaProcessor(runner).PrepareImage(context.Background(), pngSignature())
	assertMediaError(t, err, MediaDimensions, true)
	if got := runner.calls[1].maxOutputBytes; got != maxAlertImageFrames+1 {
		t.Fatalf("decode output limit = %d, want %d", got, maxAlertImageFrames+1)
	}
}

func TestPrepareSoundProbesAndNormalizesToOggOpus(t *testing.T) {
	runner := &recordingCommandRunner{results: []commandResult{
		{output: []byte(`{"streams":[{"codec_type":"audio","codec_name":"pcm_s16le","duration":"2.250"}],"format":{"duration":"2.250"}}`)},
		{output: []byte("OggSnormalized")},
	}}
	media, err := newFFmpegMediaProcessor(runner).PrepareSound(context.Background(), wavSignature())
	if err != nil {
		t.Fatal(err)
	}
	if media.MIMEType != "audio/ogg" || media.DurationMS != 2250 || string(media.Content) != "OggSnormalized" || media.Width != 0 || media.Height != 0 {
		t.Fatalf("unexpected media: %#v", media)
	}
	if len(runner.calls) != 2 || runner.calls[0].name != "ffprobe" || runner.calls[1].name != "ffmpeg" {
		t.Fatalf("calls = %#v", runner.calls)
	}
	args := strings.Join(runner.calls[1].args, " ")
	for _, required := range []string{"-threads 1", "-map 0:a:0", "-vn", "-sn", "-dn", "-map_metadata -1", "-t 30", "-ac 2", "-c:a libopus", "-b:a 64k", "-f ogg", "pipe:1"} {
		if !strings.Contains(args, required) {
			t.Errorf("ffmpeg args %q do not contain %q", args, required)
		}
	}
	inputPath := runner.calls[0].args[len(runner.calls[0].args)-1]
	ffmpegInputIndex := slices.Index(runner.calls[1].args, "-i") + 1
	if ffmpegInputIndex == 0 || inputPath != runner.calls[1].args[ffmpegInputIndex] {
		t.Fatalf("probe path %q is not the ffmpeg input in %#v", inputPath, runner.calls[1].args)
	}
	if _, err := os.Stat(inputPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("temporary input was not removed: %v", err)
	}
}

func TestPrepareSoundAcceptsSupportedContainers(t *testing.T) {
	tests := []struct {
		name    string
		content []byte
		codec   string
	}{
		{name: "wav", content: wavSignature(), codec: "pcm_f32le"},
		{name: "mp3 with id3", content: []byte("ID3payload"), codec: "mp3"},
		{name: "mp3 frame", content: []byte{0xff, 0xfb, 0x90, 0x64}, codec: "mp3"},
		{name: "ogg opus", content: []byte("OggSpayload"), codec: "opus"},
		{name: "ogg vorbis", content: []byte("OggSpayload"), codec: "vorbis"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			runner := &recordingCommandRunner{results: []commandResult{
				{output: []byte(`{"streams":[{"codec_type":"audio","codec_name":"` + test.codec + `"}],"format":{"duration":"1.0"}}`)},
				{output: []byte("OggSoutput")},
			}}
			if _, err := newFFmpegMediaProcessor(runner).PrepareSound(context.Background(), test.content); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestPrepareSoundRejectsInvalidUploads(t *testing.T) {
	tests := []struct {
		name    string
		content []byte
		probe   string
		code    MediaErrorCode
	}{
		{name: "empty", code: MediaInvalid},
		{name: "unsupported", content: []byte("video"), code: MediaUnsupported},
		{name: "video stream", content: wavSignature(), probe: `{"streams":[{"codec_type":"audio","codec_name":"pcm_s16le"},{"codec_type":"video","codec_name":"png"}],"format":{"duration":"1"}}`, code: MediaContainsVideo},
		{name: "two audio streams", content: wavSignature(), probe: `{"streams":[{"codec_type":"audio","codec_name":"pcm_s16le"},{"codec_type":"audio","codec_name":"pcm_s16le"}],"format":{"duration":"1"}}`, code: MediaInvalid},
		{name: "spoofed codec", content: []byte("OggSpayload"), probe: `{"streams":[{"codec_type":"audio","codec_name":"flac"}],"format":{"duration":"1"}}`, code: MediaInvalid},
		{name: "missing duration", content: wavSignature(), probe: `{"streams":[{"codec_type":"audio","codec_name":"pcm_s16le","duration":"N/A"}],"format":{"duration":"N/A"}}`, code: MediaInvalid},
		{name: "too long", content: wavSignature(), probe: `{"streams":[{"codec_type":"audio","codec_name":"pcm_s16le"}],"format":{"duration":"30.001"}}`, code: MediaDuration},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			runner := &recordingCommandRunner{}
			if test.probe != "" {
				runner.results = []commandResult{{output: []byte(test.probe)}}
			}
			_, err := newFFmpegMediaProcessor(runner).PrepareSound(context.Background(), test.content)
			assertMediaError(t, err, test.code, true)
		})
	}
}

func TestPrepareSoundClassifiesToolFailure(t *testing.T) {
	runner := &recordingCommandRunner{results: []commandResult{{err: &exec.Error{Name: "ffprobe", Err: exec.ErrNotFound}}}}
	_, err := newFFmpegMediaProcessor(runner).PrepareSound(context.Background(), wavSignature())
	assertMediaError(t, err, MediaToolUnavailable, false)
}

func TestPrepareSoundTimesOutTool(t *testing.T) {
	runner := &recordingCommandRunner{run: func(ctx context.Context, _ commandSpec) ([]byte, error) {
		<-ctx.Done()
		return nil, ctx.Err()
	}}
	processor := newFFmpegMediaProcessor(runner)
	processor.timeout = time.Millisecond
	_, err := processor.PrepareSound(context.Background(), wavSignature())
	assertMediaError(t, err, MediaProcessingTimedOut, false)
}

func TestLimitedBufferBoundsOutput(t *testing.T) {
	buffer := newLimitedBuffer(4)
	written, err := buffer.Write([]byte("abcdef"))
	if written != 4 || !errors.Is(err, errCommandOutputTooLarge) || buffer.String() != "abcd" || !buffer.exceeded {
		t.Fatalf("written=%d err=%v buffer=%q exceeded=%v", written, err, buffer.String(), buffer.exceeded)
	}
}

func TestNativeCommandLimiterBoundsConcurrencyAndHonorsContext(t *testing.T) {
	limiter := newNativeCommandLimiter(1)
	release, err := limiter.acquire(context.Background())
	if err != nil {
		t.Fatal(err)
	}

	waitCtx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if _, err := limiter.acquire(waitCtx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("waiting acquire error = %v, want deadline exceeded", err)
	}
	release()

	nextRelease, err := limiter.acquire(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	nextRelease()

	firstRunner := newExecCommandRunner()
	secondRunner := newExecCommandRunner()
	if firstRunner.limiter != secondRunner.limiter || firstRunner.limiter != sharedNativeCommandLimiter {
		t.Fatal("production command runners do not share the native command limiter")
	}
}

func TestFFmpegMediaProcessorIntegration(t *testing.T) {
	if _, err := exec.LookPath("ffprobe"); err != nil {
		t.Skip("ffprobe is unavailable")
	}
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg is unavailable")
	}
	media, err := NewFFmpegMediaProcessor().PrepareSound(context.Background(), silentWave(time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if media.MIMEType != "audio/ogg" || media.DurationMS != 1000 || len(media.Content) < 4 || string(media.Content[:4]) != "OggS" {
		t.Fatalf("unexpected normalized audio: type=%q duration=%d size=%d", media.MIMEType, media.DurationMS, len(media.Content))
	}
}

func TestFFmpegMediaProcessorDecodesEntireImage(t *testing.T) {
	if _, err := exec.LookPath("ffprobe"); err != nil {
		t.Skip("ffprobe is unavailable")
	}
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg is unavailable")
	}

	content := encodedPNG(t)
	processor := NewFFmpegMediaProcessor()
	media, err := processor.PrepareImage(context.Background(), content)
	if err != nil {
		t.Fatal(err)
	}
	if media.MIMEType != "image/png" || media.Width != 16 || media.Height != 16 {
		t.Fatalf("unexpected validated image: %#v", media)
	}

	corrupt := slices.Clone(content[:len(content)-1])
	_, err = processor.PrepareImage(context.Background(), corrupt)
	assertMediaError(t, err, MediaInvalid, true)

	animation := encodedGIF(t)
	media, err = processor.PrepareImage(context.Background(), animation)
	if err != nil {
		t.Fatal(err)
	}
	if media.MIMEType != "image/gif" || media.Width != 16 || media.Height != 16 || !slices.Equal(media.Content, animation) {
		t.Fatalf("unexpected validated animation: %#v", media)
	}
}

func assertMediaError(t *testing.T, err error, code MediaErrorCode, userInput bool) {
	t.Helper()
	var mediaError *MediaError
	if !errors.As(err, &mediaError) {
		t.Fatalf("expected MediaError, got %T: %v", err, err)
	}
	if mediaError.Code != code || mediaError.IsUserInput() != userInput {
		t.Fatalf("error = %#v, userInput=%v", mediaError, mediaError.IsUserInput())
	}
}

func pngSignature() []byte {
	return []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a, 0}
}

func wavSignature() []byte {
	return []byte("RIFF0000WAVE")
}

func silentWave(duration time.Duration) []byte {
	const sampleRate = 8000
	const bytesPerSample = 2
	sampleCount := int(duration.Seconds() * sampleRate)
	dataSize := sampleCount * bytesPerSample
	content := make([]byte, 44+dataSize)
	copy(content[0:4], "RIFF")
	binary.LittleEndian.PutUint32(content[4:8], uint32(len(content)-8))
	copy(content[8:12], "WAVE")
	copy(content[12:16], "fmt ")
	binary.LittleEndian.PutUint32(content[16:20], 16)
	binary.LittleEndian.PutUint16(content[20:22], 1)
	binary.LittleEndian.PutUint16(content[22:24], 1)
	binary.LittleEndian.PutUint32(content[24:28], sampleRate)
	binary.LittleEndian.PutUint32(content[28:32], sampleRate*bytesPerSample)
	binary.LittleEndian.PutUint16(content[32:34], bytesPerSample)
	binary.LittleEndian.PutUint16(content[34:36], 16)
	copy(content[36:40], "data")
	binary.LittleEndian.PutUint32(content[40:44], uint32(dataSize))
	return content
}

func encodedPNG(t *testing.T) []byte {
	t.Helper()
	picture := image.NewRGBA(image.Rect(0, 0, 16, 16))
	picture.Set(0, 0, color.RGBA{R: 255, A: 255})
	var content bytes.Buffer
	if err := png.Encode(&content, picture); err != nil {
		t.Fatal(err)
	}
	return content.Bytes()
}

func encodedGIF(t *testing.T) []byte {
	t.Helper()
	palette := color.Palette{color.Black, color.White}
	first := image.NewPaletted(image.Rect(0, 0, 16, 16), palette)
	second := image.NewPaletted(image.Rect(0, 0, 16, 16), palette)
	second.SetColorIndex(0, 0, 1)
	var content bytes.Buffer
	if err := gif.EncodeAll(&content, &gif.GIF{
		Image:     []*image.Paletted{first, second},
		Delay:     []int{10, 10},
		LoopCount: 0,
	}); err != nil {
		t.Fatal(err)
	}
	return content.Bytes()
}
