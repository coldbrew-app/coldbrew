package donationalert

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

const (
	MaxAlertImageBytes      = 4 << 20
	MaxAlertSoundBytes      = 10 << 20
	MaxAlertImageDimension  = 4096
	MaxAlertImagePixels     = 16_000_000
	MaxAlertSoundDuration   = 30 * time.Second
	MaxNormalizedSoundBytes = 2 << 20
	maxAlertImageFrames     = 300
	maxAlertImageWorkPixels = 240_000_000
	maxConcurrentCommands   = 2
	maxNativeAllocation     = 256 << 20
	mediaCommandTimeout     = 10 * time.Second
	maxProbeOutputBytes     = 64 << 10
	maxCommandErrorBytes    = 16 << 10
	normalizedSoundMIMEType = "audio/ogg"
)

// Media is validated content ready to persist and serve to an alert player.
// Dimensions are zero for audio, and DurationMS is zero for images.
type Media struct {
	MIMEType   string
	Content    []byte
	DurationMS int
	Width      int
	Height     int
}

type MediaErrorCode string

const (
	MediaTooLarge           MediaErrorCode = "too_large"
	MediaUnsupported        MediaErrorCode = "unsupported"
	MediaInvalid            MediaErrorCode = "invalid"
	MediaDimensions         MediaErrorCode = "dimensions"
	MediaDuration           MediaErrorCode = "duration"
	MediaContainsVideo      MediaErrorCode = "video"
	MediaToolUnavailable    MediaErrorCode = "tool_unavailable"
	MediaProcessingFailed   MediaErrorCode = "processing_failed"
	MediaProcessingTimedOut MediaErrorCode = "processing_timed_out"
)

type MediaError struct {
	Code MediaErrorCode
	Err  error
}

func (e *MediaError) Error() string {
	if e.Err == nil {
		return "alert media " + string(e.Code)
	}
	return "alert media " + string(e.Code) + ": " + e.Err.Error()
}

func (e *MediaError) Unwrap() error { return e.Err }

// IsUserInput reports whether retrying the same upload cannot succeed.
func (e *MediaError) IsUserInput() bool {
	switch e.Code {
	case MediaTooLarge, MediaUnsupported, MediaInvalid, MediaDimensions, MediaDuration, MediaContainsVideo:
		return true
	case MediaToolUnavailable, MediaProcessingFailed, MediaProcessingTimedOut:
		return false
	default:
		return false
	}
}

type MediaProcessor interface {
	PrepareImage(context.Context, []byte) (Media, error)
	PrepareSound(context.Context, []byte) (Media, error)
}

type FFmpegMediaProcessor struct {
	runner  commandRunner
	timeout time.Duration
}

func NewFFmpegMediaProcessor() MediaProcessor {
	return &FFmpegMediaProcessor{runner: newExecCommandRunner(), timeout: mediaCommandTimeout}
}

func newFFmpegMediaProcessor(runner commandRunner) *FFmpegMediaProcessor {
	return &FFmpegMediaProcessor{runner: runner, timeout: mediaCommandTimeout}
}

func (processor *FFmpegMediaProcessor) PrepareImage(ctx context.Context, content []byte) (Media, error) {
	if len(content) == 0 {
		return Media{}, &MediaError{Code: MediaInvalid, Err: errors.New("empty image")}
	}
	if len(content) > MaxAlertImageBytes {
		return Media{}, &MediaError{Code: MediaTooLarge}
	}
	detected, ok := detectImage(content)
	if !ok {
		return Media{}, &MediaError{Code: MediaUnsupported}
	}
	probe, path, cleanup, err := processor.probeFile(ctx, content)
	if err != nil {
		return Media{}, err
	}
	defer cleanup()
	if len(probe.Streams) != 1 || probe.Streams[0].CodecType != "video" {
		return Media{}, &MediaError{Code: MediaInvalid, Err: errors.New("expected one image stream")}
	}
	stream := probe.Streams[0]
	if !imageCodecMatches(detected, stream.CodecName) {
		return Media{}, &MediaError{Code: MediaInvalid, Err: errors.New("file signature and decoded image disagree")}
	}
	if stream.Width <= 0 || stream.Height <= 0 {
		return Media{}, &MediaError{Code: MediaInvalid, Err: errors.New("image dimensions are unavailable")}
	}
	if stream.Width > MaxAlertImageDimension || stream.Height > MaxAlertImageDimension || int64(stream.Width)*int64(stream.Height) > MaxAlertImagePixels {
		return Media{}, &MediaError{Code: MediaDimensions}
	}
	if err := processor.validateImageDecode(ctx, path, imageFrameLimit(stream.Width, stream.Height)); err != nil {
		return Media{}, err
	}
	return Media{
		MIMEType: detected,
		Content:  append([]byte(nil), content...),
		Width:    stream.Width,
		Height:   stream.Height,
	}, nil
}

func (processor *FFmpegMediaProcessor) PrepareSound(ctx context.Context, content []byte) (Media, error) {
	if len(content) == 0 {
		return Media{}, &MediaError{Code: MediaInvalid, Err: errors.New("empty sound")}
	}
	if len(content) > MaxAlertSoundBytes {
		return Media{}, &MediaError{Code: MediaTooLarge}
	}
	detected, ok := detectSound(content)
	if !ok {
		return Media{}, &MediaError{Code: MediaUnsupported}
	}
	probe, path, cleanup, err := processor.probeFile(ctx, content)
	if err != nil {
		return Media{}, err
	}
	defer cleanup()

	var audio *probeStream
	for index := range probe.Streams {
		stream := &probe.Streams[index]
		switch stream.CodecType {
		case "video":
			return Media{}, &MediaError{Code: MediaContainsVideo}
		case "audio":
			if audio != nil {
				return Media{}, &MediaError{Code: MediaInvalid, Err: errors.New("expected one audio stream")}
			}
			audio = stream
		default:
			return Media{}, &MediaError{Code: MediaInvalid, Err: fmt.Errorf("unexpected %s stream", stream.CodecType)}
		}
	}
	if audio == nil || !audioCodecMatches(detected, audio.CodecName) {
		return Media{}, &MediaError{Code: MediaInvalid, Err: errors.New("file signature and decoded audio disagree")}
	}
	duration, err := probe.duration(*audio)
	if err != nil || duration <= 0 {
		return Media{}, &MediaError{Code: MediaInvalid, Err: errors.New("audio duration is unavailable")}
	}
	if duration > MaxAlertSoundDuration {
		return Media{}, &MediaError{Code: MediaDuration}
	}

	commandCtx, cancel := context.WithTimeout(ctx, processor.timeout)
	defer cancel()
	output, err := processor.runner.Run(commandCtx, commandSpec{
		name: "ffmpeg",
		args: []string{
			"-nostdin", "-hide_banner", "-loglevel", "error", "-max_alloc", strconv.Itoa(maxNativeAllocation), "-threads", "1",
			"-i", path,
			"-map", "0:a:0", "-vn", "-sn", "-dn", "-map_metadata", "-1",
			"-t", "30", "-ac", "2", "-ar", "48000",
			"-c:a", "libopus", "-b:a", "64k", "-vbr", "on",
			"-f", "ogg", "pipe:1",
		},
		maxOutputBytes: MaxNormalizedSoundBytes,
	})
	if err != nil {
		return Media{}, mediaCommandError(commandCtx, err)
	}
	if len(output) < 4 || !bytes.Equal(output[:4], []byte("OggS")) {
		return Media{}, &MediaError{Code: MediaProcessingFailed, Err: errors.New("ffmpeg returned invalid Ogg output")}
	}
	return Media{
		MIMEType:   normalizedSoundMIMEType,
		Content:    append([]byte(nil), output...),
		DurationMS: int(math.Round(duration.Seconds() * 1000)),
	}, nil
}

func imageFrameLimit(width, height int) int {
	pixels := int64(width) * int64(height)
	workLimit := int(int64(maxAlertImageWorkPixels) / pixels)
	if workLimit < 1 {
		return 1
	}
	if workLimit < maxAlertImageFrames {
		return workLimit
	}
	return maxAlertImageFrames
}

func (processor *FFmpegMediaProcessor) validateImageDecode(ctx context.Context, path string, frameLimit int) error {
	commandCtx, cancel := context.WithTimeout(ctx, processor.timeout)
	defer cancel()
	output, err := processor.runner.Run(commandCtx, commandSpec{
		name: "ffmpeg",
		args: []string{
			"-nostdin", "-hide_banner", "-loglevel", "error", "-xerror",
			"-max_alloc", strconv.Itoa(maxNativeAllocation), "-threads", "1",
			"-i", path,
			"-map", "0:v:0", "-an", "-sn", "-dn",
			"-vf", "scale=1:1:flags=neighbor,format=gray",
			"-frames:v", strconv.Itoa(frameLimit + 1), "-fps_mode", "passthrough",
			"-f", "rawvideo", "pipe:1",
		},
		maxOutputBytes: frameLimit + 1,
	})
	if err != nil {
		if errors.Is(err, errCommandOutputTooLarge) {
			return &MediaError{Code: MediaDimensions, Err: errors.New("image animation exceeds work limit")}
		}
		if commandCtx.Err() != nil || commandUnavailable(err) {
			return mediaCommandError(commandCtx, err)
		}
		return &MediaError{Code: MediaInvalid, Err: fmt.Errorf("decode image: %w", err)}
	}
	if len(output) == 0 {
		return &MediaError{Code: MediaInvalid, Err: errors.New("image contains no decodable frames")}
	}
	if len(output) > frameLimit {
		return &MediaError{Code: MediaDimensions, Err: errors.New("image animation exceeds work limit")}
	}
	return nil
}

type probeOutput struct {
	Streams []probeStream `json:"streams"`
	Format  probeFormat   `json:"format"`
}

type probeStream struct {
	CodecType string `json:"codec_type"`
	CodecName string `json:"codec_name"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
	Duration  string `json:"duration"`
}

type probeFormat struct {
	Duration string `json:"duration"`
}

func (probe probeOutput) duration(stream probeStream) (time.Duration, error) {
	value := stream.Duration
	if value == "" || value == "N/A" {
		value = probe.Format.Duration
	}
	seconds, err := strconv.ParseFloat(value, 64)
	if err != nil || math.IsNaN(seconds) || math.IsInf(seconds, 0) {
		return 0, errors.New("invalid duration")
	}
	return time.Duration(seconds * float64(time.Second)), nil
}

func (processor *FFmpegMediaProcessor) probeFile(ctx context.Context, content []byte) (probeOutput, string, func(), error) {
	file, err := os.CreateTemp("", "streambrew-alert-media-*")
	if err != nil {
		return probeOutput{}, "", nil, &MediaError{Code: MediaProcessingFailed, Err: err}
	}
	path := file.Name()
	cleanup := func() { _ = os.Remove(path) }
	if _, writeErr := file.Write(content); writeErr != nil {
		_ = file.Close()
		cleanup()
		return probeOutput{}, "", nil, &MediaError{Code: MediaProcessingFailed, Err: writeErr}
	}
	if closeErr := file.Close(); closeErr != nil {
		cleanup()
		return probeOutput{}, "", nil, &MediaError{Code: MediaProcessingFailed, Err: closeErr}
	}

	commandCtx, cancel := context.WithTimeout(ctx, processor.timeout)
	defer cancel()
	output, err := processor.runner.Run(commandCtx, commandSpec{
		name: "ffprobe",
		args: []string{
			"-v", "error", "-max_alloc", strconv.Itoa(maxNativeAllocation),
			"-print_format", "json", "-show_format", "-show_streams",
			"-show_entries", "stream=codec_type,codec_name,width,height,duration:format=duration",
			path,
		},
		maxOutputBytes: maxProbeOutputBytes,
	})
	if err != nil {
		cleanup()
		if commandCtx.Err() != nil || commandUnavailable(err) {
			return probeOutput{}, "", nil, mediaCommandError(commandCtx, err)
		}
		return probeOutput{}, "", nil, &MediaError{Code: MediaInvalid, Err: err}
	}
	var probe probeOutput
	if err := json.Unmarshal(output, &probe); err != nil {
		cleanup()
		return probeOutput{}, "", nil, &MediaError{Code: MediaProcessingFailed, Err: fmt.Errorf("decode ffprobe output: %w", err)}
	}
	return probe, path, cleanup, nil
}

func mediaCommandError(ctx context.Context, err error) error {
	if errors.Is(ctx.Err(), context.Canceled) {
		return context.Canceled
	}
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return &MediaError{Code: MediaProcessingTimedOut, Err: err}
	}
	if commandUnavailable(err) {
		return &MediaError{Code: MediaToolUnavailable, Err: err}
	}
	return &MediaError{Code: MediaProcessingFailed, Err: err}
}

func detectImage(content []byte) (string, bool) {
	switch {
	case len(content) >= 8 && bytes.Equal(content[:8], []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}):
		return "image/png", true
	case len(content) >= 3 && content[0] == 0xff && content[1] == 0xd8 && content[2] == 0xff:
		return "image/jpeg", true
	case len(content) >= 6 && (bytes.Equal(content[:6], []byte("GIF87a")) || bytes.Equal(content[:6], []byte("GIF89a"))):
		return "image/gif", true
	case len(content) >= 12 && bytes.Equal(content[:4], []byte("RIFF")) && bytes.Equal(content[8:12], []byte("WEBP")):
		return "image/webp", true
	default:
		return "", false
	}
}

func detectSound(content []byte) (string, bool) {
	switch {
	case len(content) >= 12 && bytes.Equal(content[:4], []byte("RIFF")) && bytes.Equal(content[8:12], []byte("WAVE")):
		return "audio/wav", true
	case len(content) >= 3 && bytes.Equal(content[:3], []byte("ID3")):
		return "audio/mpeg", true
	case len(content) >= 2 && content[0] == 0xff && content[1]&0xe0 == 0xe0:
		return "audio/mpeg", true
	case len(content) >= 4 && bytes.Equal(content[:4], []byte("OggS")):
		return "audio/ogg", true
	default:
		return "", false
	}
}

func imageCodecMatches(mimeType, codec string) bool {
	switch mimeType {
	case "image/png":
		return codec == "png" || codec == "apng"
	case "image/jpeg":
		return codec == "mjpeg"
	case "image/gif":
		return codec == "gif"
	case "image/webp":
		return codec == "webp"
	default:
		return false
	}
}

func audioCodecMatches(mimeType, codec string) bool {
	switch mimeType {
	case "audio/mpeg":
		return codec == "mp3"
	case "audio/ogg":
		return codec == "opus" || codec == "vorbis"
	case "audio/wav":
		return strings.HasPrefix(codec, "pcm_") || strings.HasPrefix(codec, "adpcm_") || codec == "mp3"
	default:
		return false
	}
}

var errCommandOutputTooLarge = errors.New("command output exceeds limit")

type commandSpec struct {
	name           string
	args           []string
	input          []byte
	maxOutputBytes int
}

type commandRunner interface {
	Run(context.Context, commandSpec) ([]byte, error)
}

type nativeCommandLimiter struct {
	slots chan struct{}
}

var sharedNativeCommandLimiter = newNativeCommandLimiter(maxConcurrentCommands)

func newNativeCommandLimiter(limit int) *nativeCommandLimiter {
	if limit < 1 {
		panic("native command concurrency limit must be positive")
	}
	return &nativeCommandLimiter{slots: make(chan struct{}, limit)}
}

func (limiter *nativeCommandLimiter) acquire(ctx context.Context) (func(), error) {
	select {
	case limiter.slots <- struct{}{}:
		return func() { <-limiter.slots }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

type execCommandRunner struct {
	limiter *nativeCommandLimiter
}

func newExecCommandRunner() execCommandRunner {
	return execCommandRunner{limiter: sharedNativeCommandLimiter}
}

func (runner execCommandRunner) Run(ctx context.Context, spec commandSpec) ([]byte, error) {
	limiter := runner.limiter
	if limiter == nil {
		limiter = sharedNativeCommandLimiter
	}
	release, err := limiter.acquire(ctx)
	if err != nil {
		return nil, err
	}
	defer release()

	// Executable names and arguments come only from the fixed ffmpeg, ffprobe,
	// and espeak command specifications constructed in this package.
	command := exec.CommandContext(ctx, spec.name, spec.args...) //nolint:gosec
	command.Stdin = bytes.NewReader(spec.input)
	stdout := newLimitedBuffer(spec.maxOutputBytes)
	stderr := newLimitedBuffer(maxCommandErrorBytes)
	command.Stdout = stdout
	command.Stderr = stderr
	err = command.Run()
	if stdout.exceeded {
		return nil, errCommandOutputTooLarge
	}
	if err != nil {
		message := strings.TrimSpace(stderr.String())
		if message != "" {
			return nil, fmt.Errorf("run %s: %w: %s", spec.name, err, message)
		}
		return nil, fmt.Errorf("run %s: %w", spec.name, err)
	}
	return append([]byte(nil), stdout.Bytes()...), nil
}

func commandUnavailable(err error) bool {
	var execError *exec.Error
	return errors.As(err, &execError) || errors.Is(err, exec.ErrNotFound)
}

type limitedBuffer struct {
	bytes.Buffer
	limit    int
	exceeded bool
}

func newLimitedBuffer(limit int) *limitedBuffer {
	return &limitedBuffer{limit: limit}
}

func (buffer *limitedBuffer) Write(content []byte) (int, error) {
	remaining := buffer.limit - buffer.Len()
	if remaining <= 0 {
		buffer.exceeded = true
		return 0, errCommandOutputTooLarge
	}
	if len(content) > remaining {
		_, _ = buffer.Buffer.Write(content[:remaining])
		buffer.exceeded = true
		return remaining, errCommandOutputTooLarge
	}
	return buffer.Buffer.Write(content)
}

var _ io.Writer = (*limitedBuffer)(nil)
