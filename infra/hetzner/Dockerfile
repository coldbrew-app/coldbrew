FROM golang:1.27.1-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY apps/restream ./apps/restream
COPY internal/restream ./internal/restream
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/restream-media ./apps/restream

FROM bluenviron/mediamtx:1.21.0 AS mediamtx

FROM alpine:3.22
RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -S restream \
    && adduser -S -G restream restream
COPY --from=build /out/restream-media /restream-media
COPY --from=mediamtx /mediamtx /mediamtx
COPY infra/hetzner/mediamtx.yml /etc/mediamtx.yml
USER restream
EXPOSE 1935
ENTRYPOINT ["/restream-media"]
