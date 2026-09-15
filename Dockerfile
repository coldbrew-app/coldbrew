FROM oven/bun:1.3.14 AS dependencies

WORKDIR /app

COPY package.json bun.lock ./
COPY packages/package.json packages/package.json
COPY apps/web/package.json apps/web/package.json
RUN bun install --frozen-lockfile

FROM dependencies AS build

COPY . .

RUN bun run --cwd apps/web build

FROM golang:1.27.1-alpine AS go-build

WORKDIR /src

RUN apk add --no-cache ca-certificates

COPY go.mod go.sum ./
RUN go mod download

COPY apps/video ./apps/video
COPY apps/donations ./apps/donations
COPY apps/chat ./apps/chat
COPY apps/alerts ./apps/alerts
COPY internal ./internal

RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/ \
    ./apps/video ./apps/donations ./apps/chat ./apps/alerts

FROM oven/bun:1.3.14-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production

RUN apk add --no-cache espeak-ng ffmpeg \
    && espeak-ng --version \
    && ffmpeg -version >/dev/null \
    && ffprobe -version >/dev/null \
    && printf 'Проверка русской речи\n' \
        | espeak-ng -b 1 -v ru -s 165 --stdin --stdout > /tmp/streambrew-tts-smoke.wav \
    && ffmpeg -nostdin -hide_banner -loglevel error -threads 1 \
        -i /tmp/streambrew-tts-smoke.wav -map 0:a:0 -vn -sn -dn -map_metadata -1 \
        -t 30 -ac 2 -ar 48000 -c:a libopus -b:a 64k -vbr on \
        -f ogg /tmp/streambrew-tts-smoke.ogg \
    && test "$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_name \
        -of default=nokey=1:noprint_wrappers=1 /tmp/streambrew-tts-smoke.ogg)" = opus \
    && rm -f /tmp/streambrew-tts-smoke.wav /tmp/streambrew-tts-smoke.ogg

COPY --from=build --chown=bun:bun /app/apps/web/.output ./apps/web/.output
COPY --from=go-build --chown=bun:bun /out/chat ./bin/chat
COPY --from=go-build --chown=bun:bun /out/alerts ./bin/alerts
COPY --from=go-build --chown=bun:bun /out/donations ./bin/donations
COPY --from=go-build --chown=bun:bun /out/video ./bin/video
COPY --from=go-build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt

RUN test -s /etc/ssl/certs/ca-certificates.crt

USER bun
