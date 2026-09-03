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
COPY internal ./internal

RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/video ./apps/video
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/donations ./apps/donations
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/chat ./apps/chat

FROM oven/bun:1.3.14 AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY --from=dependencies --chown=bun:bun /app/node_modules ./node_modules
COPY --from=build --chown=bun:bun /app/package.json ./package.json
COPY --from=build --chown=bun:bun /app/packages ./packages
COPY --from=build --chown=bun:bun /app/apps/web/package.json ./apps/web/package.json
COPY --from=build --chown=bun:bun /app/apps/web/.output ./apps/web/.output
COPY --from=go-build --chown=bun:bun /out/chat ./bin/chat
COPY --from=go-build --chown=bun:bun /out/donations ./bin/donations
COPY --from=go-build --chown=bun:bun /out/video ./bin/video
COPY --from=go-build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt

RUN test -s /etc/ssl/certs/ca-certificates.crt

USER bun
