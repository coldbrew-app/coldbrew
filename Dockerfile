FROM oven/bun:1.3.14 AS dependencies

WORKDIR /app

COPY package.json bun.lock ./
COPY packages/package.json packages/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/chat/package.json apps/chat/package.json
COPY apps/donationalerts/package.json apps/donationalerts/package.json
COPY apps/video/package.json apps/video/package.json

RUN bun install --frozen-lockfile

FROM dependencies AS build

COPY . .

RUN bun run --cwd apps/web build

FROM oven/bun:1.3.14 AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY --from=dependencies --chown=bun:bun /app/node_modules ./node_modules
COPY --from=build --chown=bun:bun /app/package.json ./package.json
COPY --from=build --chown=bun:bun /app/packages ./packages
COPY --from=build --chown=bun:bun /app/apps/web/package.json ./apps/web/package.json
COPY --from=build --chown=bun:bun /app/apps/web/.output ./apps/web/.output
COPY --from=build --chown=bun:bun /app/apps/chat ./apps/chat
COPY --from=build --chown=bun:bun /app/apps/donationalerts ./apps/donationalerts
COPY --from=build --chown=bun:bun /app/apps/video ./apps/video

USER bun
