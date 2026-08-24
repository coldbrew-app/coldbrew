[default]
default:
  @just --list

install:
  bun install

dev-donationalerts:
  dotenvx run -f .env.dev -- bun --watch apps/donationalerts/src/index.ts

dev-video:
  dotenvx run -f .env.dev -- bun --watch apps/video/src/index.ts

dev-web:
  dotenvx run -f .env.dev -- sh -c 'cd apps/web && bun run dev'

dev:
  bunx concurrently -n 'web,donationalerts,video' 'just dev-web' 'just dev-donationalerts' 'just dev-video'

typecheck-web:
  bunx tsc --noEmit -p apps/web/tsconfig.node.json
  bunx tsc --noEmit -p apps/web/tsconfig.json

typecheck-donationalerts:
  bunx tsc --noEmit -p apps/donationalerts/tsconfig.json

typecheck-video:
  bunx tsc --noEmit -p apps/video/tsconfig.json

typecheck-packages:
  bunx tsc --noEmit -p packages/tsconfig.json

typecheck: typecheck-web typecheck-donationalerts typecheck-video typecheck-packages


fmt:
  bunx oxfmt

fmt-check:
  bunx oxfmt --check

lint:
  bunx oxlint

build-web: install
  cd apps/web && bunx vite build

compose-up:
  docker compose up --build -d

compose-db-up:
  docker compose up -d postgres

compose-down:
  docker compose down

backup-now:
  docker compose run --rm --no-deps wal-g wal-g backup-push

backup-list:
  docker compose run --rm --no-deps wal-g wal-g backup-list

backup-verify:
  docker compose run --rm --no-deps wal-g wal-g wal-verify integrity

test-web: install
  dotenvx run -f .env.dev -- bunx vitest --run apps/web

test-donationalerts: install
  dotenvx run -f .env.dev -- bunx vitest --run apps/donationalerts

test-video: install
  dotenvx run -f .env.dev -- bunx vitest --run apps/video

test-packages: install
  dotenvx run -f .env.dev -- bunx vitest --run packages

test: test-web test-donationalerts test-video test-packages

check: lint fmt-check test

schema-apply:
  pgschema apply --auto-approve --file db/schema.sql

schema-reset:
  pgschema apply --auto-approve --file db/empty.sql
  just schema-apply


# Count production code and TypeScript tests in one report.
count-lines path=".":
  cloc --config .config/cloc-options.txt "{{path}}"

env-decrypt-prod:
  dotenvx decrypt -f .env.prod

env-decrypt-dev:
  dotenvx decrypt -f .env.dev

env-decrypt: env-decrypt-dev env-decrypt-prod


env-encrypt-prod:
  dotenvx encrypt -f .env.prod

env-encrypt-dev:
  dotenvx encrypt -f .env.dev

env-encrypt: env-encrypt-dev env-encrypt-prod
