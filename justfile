[default]
default:
  @just --list

install:
  bun install

# Build the runtime environment for the current worktree from long-lived dev settings.
env-init source-env=".env.dev":
  #!/usr/bin/env bash
  set -euo pipefail

  app_port="$(wt step eval '{{{{ (repo ~ "-app-" ~ branch) | hash_port }}')"
  db_port="$(wt step eval '{{{{ (repo ~ "-db-" ~ branch) | hash_port }}')"
  db_name="coldbrew_$(wt step eval '{{{{ branch | sanitize_db }}')"
  compose_project="$(wt step eval '{{{{ (repo ~ "_" ~ branch) | sanitize_db }}')"

  bunx dotenvx decrypt -f "{{source-env}}" -fk .env.keys --stdout > .env
  bunx dotenvx set -f .env --plain APP_PORT "$app_port"
  bunx dotenvx set -f .env --plain APP_DOMAIN "http://localhost:$app_port"
  bunx dotenvx set -f .env --plain PGHOST 127.0.0.1
  bunx dotenvx set -f .env --plain PGPORT "$db_port"
  bunx dotenvx set -f .env --plain PGDATABASE "$db_name"
  bunx dotenvx set -f .env --plain COMPOSE_PROJECT_NAME "$compose_project"

  bunx dotenvx run -f .env --overload -- bash -c 'bunx dotenvx set -f .env --plain DATABASE_URL "postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}"'

  chmod 600 .env

dev-donationalerts:
  bunx dotenvx run -f .env --overload -- bun --watch apps/donationalerts/src/index.ts

dev-video:
  bunx dotenvx run -f .env --overload -- bun --watch apps/video/src/index.ts

dev-web:
  bunx dotenvx run -f .env --overload -- sh -c 'cd apps/web && bun run dev'

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

generate-youtube-chat-proto: install
  cd packages && ./node_modules/.bin/grpc_tools_node_protoc \
    --plugin=protoc-gen-ts_proto=./node_modules/.bin/protoc-gen-ts_proto \
    --ts_proto_out=src/youtube-live-chat/generated \
    --ts_proto_opt=outputServices=nice-grpc,outputServices=generic-definitions,outputJsonMethods=false,useExactTypes=false,esModuleInterop=true,importSuffix=.js,forceLong=string \
    --proto_path=src/youtube-live-chat/proto \
    --proto_path=node_modules/grpc-tools/bin \
    src/youtube-live-chat/proto/stream_list.proto
  cd packages && bunx oxfmt src/youtube-live-chat/generated

compose-up:
  docker compose up -d

# Pull immutable production images, recreate the stack, and verify the public endpoint.
production-deploy app_image postgres_image:
  #!/usr/bin/env bash
  set -euo pipefail

  export COLDBREW_IMAGE="{{app_image}}"
  export COLDBREW_POSTGRES_IMAGE="{{postgres_image}}"

  docker compose pull postgres web
  docker compose up --no-build --detach --wait --wait-timeout 180
  bunx dotenvx run -f .env --overload -- \
    bash -c 'curl --fail --silent --show-error --retry 10 --retry-delay 3 --retry-connrefused "${APP_DOMAIN%/}/api/health" >/dev/null'

compose-db-up:
  docker compose up -d postgres

compose-down:
  docker compose down

dev-db-up:
  bunx dotenvx run -f .env --overload -- docker compose -f compose.dev.yaml up -d --wait

dev-db-copy $source_worktree:
  #!/usr/bin/env bash
  set -euo pipefail

  target_worktree="$(pwd -P)"

  if [[ ! -d "$source_worktree" ]]; then
    echo "Source worktree does not exist: $source_worktree" >&2
    exit 1
  fi

  source_worktree="$(cd "$source_worktree" && pwd -P)"

  if [[ "$source_worktree" == "$target_worktree" ]]; then
    echo "Refusing to copy the development database onto itself" >&2
    exit 1
  fi

  if [[ ! -f "$source_worktree/.env" ]]; then
    echo "Source worktree has no .env file: $source_worktree" >&2
    exit 1
  fi

  if [[ ! -f "$source_worktree/compose.dev.yaml" ]]; then
    echo "Source worktree has no compose.dev.yaml file: $source_worktree" >&2
    exit 1
  fi

  if ! (
    cd "$source_worktree"
    bunx dotenvx run -f .env --overload -- docker compose -f compose.dev.yaml exec -T postgres true
  ); then
    echo "Source development database is not running: $source_worktree" >&2
    exit 1
  fi

  dump_path="$(mktemp "${TMPDIR:-/tmp}/coldbrew-dev-db.XXXXXX.dump")"
  trap 'rm -f "$dump_path"' EXIT

  (
    cd "$source_worktree"
    bunx dotenvx run -f .env --overload -- docker compose -f compose.dev.yaml exec -T postgres \
      sh -c 'pg_dump --format=custom --no-owner --no-privileges --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"'
  ) > "$dump_path"

  bunx dotenvx run -f .env --overload -- docker compose -f compose.dev.yaml exec -T postgres \
    sh -c 'pg_restore --clean --if-exists --no-owner --no-privileges --single-transaction --exit-on-error --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' \
    < "$dump_path"

dev-db-down:
  bunx dotenvx run -f .env --overload -- docker compose -f compose.dev.yaml down

dev-db-destroy:
  bunx dotenvx run -f .env --overload -- docker compose -f compose.dev.yaml down --volumes

backup-now:
  docker compose run --rm --no-deps wal-g wal-g backup-push

backup-list:
  docker compose run --rm --no-deps wal-g wal-g backup-list

backup-verify:
  docker compose run --rm --no-deps wal-g wal-g wal-verify integrity

test-web: install
  bunx dotenvx run -f .env --overload -- bunx vitest --run apps/web

test-donationalerts: install
  bunx dotenvx run -f .env --overload -- bunx vitest --run apps/donationalerts

test-video: install
  bunx dotenvx run -f .env --overload -- bunx vitest --run apps/video

test-packages: install
  bunx dotenvx run -f .env --overload -- bunx vitest --run packages

test: test-web test-donationalerts test-video test-packages

check: lint fmt-check test

schema-apply:
  bunx dotenvx run -f .env --overload -- pgschema apply --auto-approve --file db/schema.sql

schema-reset:
  bunx dotenvx run -f .env --overload -- pgschema apply --auto-approve --file db/empty.sql
  just schema-apply


# Count production code and TypeScript tests in one report.
count-lines path=".":
  cloc --config .config/cloc-options.txt "{{path}}"

env-decrypt-prod:
  bunx dotenvx decrypt -f .env.prod

env-decrypt-dev:
  bunx dotenvx decrypt -f .env.dev

env-decrypt: env-decrypt-dev env-decrypt-prod


env-encrypt-prod:
  bunx dotenvx encrypt -f .env.prod

env-encrypt-dev:
  bunx dotenvx encrypt -f .env.dev

env-encrypt: env-encrypt-dev env-encrypt-prod
