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
  chat_port="$(wt step eval '{{{{ (repo ~ "-chat-" ~ branch) | hash_port }}')"
  donations_port="$(wt step eval '{{{{ (repo ~ "-donations-" ~ branch) | hash_port }}')"
  nats_port="$(wt step eval '{{{{ (repo ~ "-nats-" ~ branch) | hash_port }}')"
  db_name="coldbrew_$(wt step eval '{{{{ branch | sanitize_db }}')"
  compose_project="$(wt step eval '{{{{ (repo ~ "_" ~ branch) | sanitize_db }}')"

  bunx dotenvx decrypt -f "{{source-env}}" -fk .env.keys --stdout > .env
  bunx dotenvx set -f .env --plain APP_PORT "$app_port"
  bunx dotenvx set -f .env --plain APP_DOMAIN "http://localhost:$app_port"
  bunx dotenvx set -f .env --plain CHAT_PORT "$chat_port"
  bunx dotenvx set -f .env --plain CHAT_PUBLIC_URL "http://localhost:$app_port/api/chat"
  bunx dotenvx set -f .env --plain CHAT_SERVICE_URL "http://127.0.0.1:$chat_port"
  bunx dotenvx set -f .env --plain CHAT_WEB_URL "http://localhost:$app_port"
  bunx dotenvx set -f .env --plain DONATIONS_PORT "$donations_port"
  bunx dotenvx set -f .env --plain DONATIONS_SERVICE_URL "http://127.0.0.1:$donations_port"
  bunx dotenvx set -f .env --plain NATS_PORT "$nats_port"
  bunx dotenvx set -f .env --plain NATS_SERVERS "nats://127.0.0.1:$nats_port"
  bunx dotenvx set -f .env --plain PGHOST 127.0.0.1
  bunx dotenvx set -f .env --plain PGPORT "$db_port"
  bunx dotenvx set -f .env --plain PGDATABASE "$db_name"
  bunx dotenvx set -f .env --plain COMPOSE_PROJECT_NAME "$compose_project"

  bunx dotenvx run -f .env --overload -- bash -c 'bunx dotenvx set -f .env --plain DATABASE_URL "postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}"'

  chmod 600 .env

dev-donations:
  bunx dotenvx run -f .env --overload -- go run ./apps/donations

dev-video:
  bunx dotenvx run -f .env --overload -- go run ./apps/video

dev-chat:
  bunx dotenvx run -f .env --overload -- go run ./apps/chat

dev-web:
  bunx dotenvx run -f .env --overload -- sh -c 'cd apps/web && bun run dev'

dev:
  bunx concurrently -n 'web,chat,donations,video' 'just dev-web' 'just dev-chat' 'just dev-donations' 'just dev-video'

typecheck-web:
  bunx tsc --noEmit -p apps/web/tsconfig.node.json
  bunx tsc --noEmit -p apps/web/tsconfig.json

typecheck-donations:
  go test ./apps/donations ./internal/donations ./internal/donationalerts

typecheck-video:
  go test ./apps/video ./internal/videoingest ./internal/money ./internal/youtube

typecheck-chat:
  go test ./apps/chat ./internal/chat

typecheck-packages:
  bunx tsc --noEmit -p packages/tsconfig.json

typecheck: typecheck-web typecheck-chat typecheck-donations typecheck-video typecheck-packages


fmt:
  bunx oxfmt
  go fmt ./...

fmt-check:
  bunx oxfmt --check
  gofmt -l apps internal | awk '{ print; found = 1 } END { exit found }'

lint-ts:
  bunx oxlint

lint-go:
  #!/usr/bin/env bash
  set -euo pipefail

  go vet ./...
  stderr_file="$(mktemp)"
  trap 'rm -f "$stderr_file"' EXIT
  if ! diagnostics="$(rg --files --glob '*.go' | xargs go tool gopls check 2>"$stderr_file")"; then
    cat "$stderr_file" >&2
    printf '%s\n' "$diagnostics" >&2
    exit 1
  fi
  if grep -qv '^go: downloading ' "$stderr_file"; then
    grep -v '^go: downloading ' "$stderr_file" >&2
    exit 1
  fi
  if [[ -n "$diagnostics" ]]; then
    printf '%s\n' "$diagnostics"
    exit 1
  fi

lint: lint-ts lint-go

build-web: install
  cd apps/web && bunx vite build

generate-youtube-chat-go-proto:
  #!/usr/bin/env bash
  set -euo pipefail

  tool_dir="$(mktemp -d "${TMPDIR:-/tmp}/coldbrew-protoc.XXXXXX")"
  trap 'rm -rf "$tool_dir"' EXIT
  GOBIN="$tool_dir" go install google.golang.org/protobuf/cmd/protoc-gen-go@v1.36.11
  GOBIN="$tool_dir" go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@v1.6.2
  PATH="$tool_dir:$PATH" protoc \
    --proto_path=internal/youtubechatpb \
    --go_out=internal/youtubechatpb \
    --go_opt=paths=source_relative \
    --go_opt=Mstream_list.proto=github.com/lebedev-nikita/coldbrew/internal/youtubechatpb \
    --go-grpc_out=internal/youtubechatpb \
    --go-grpc_opt=paths=source_relative \
    --go-grpc_opt=Mstream_list.proto=github.com/lebedev-nikita/coldbrew/internal/youtubechatpb \
    internal/youtubechatpb/stream_list.proto

compose-up:
  docker compose up -d

# Pull immutable production images, recreate the stack, and verify the public endpoint.
production-deploy app_image postgres_image:
  #!/usr/bin/env bash
  set -euo pipefail

  export COLDBREW_IMAGE="{{app_image}}"
  export COLDBREW_POSTGRES_IMAGE="{{postgres_image}}"

  # Keep manual Compose operations and host restarts on the deployed immutable images.
  bunx dotenvx set -f .env --plain COLDBREW_IMAGE "$COLDBREW_IMAGE"
  bunx dotenvx set -f .env --plain COLDBREW_POSTGRES_IMAGE "$COLDBREW_POSTGRES_IMAGE"

  docker compose pull postgres web
  docker compose up --no-build --detach --wait --wait-timeout 180
  # Git may replace the bind-mounted Caddyfile inode without Compose detecting
  # a service change. Recreate Caddy so it mounts the checked-out revision.
  # The same recipe also recreates it with the previous file during rollback.
  docker compose up --no-build --detach --wait --wait-timeout 180 --force-recreate --no-deps caddy
  bunx dotenvx run -f .env --overload -- \
    bash -c 'curl --fail --silent --show-error --retry 10 --retry-delay 3 --retry-connrefused "${APP_DOMAIN%/}/api/health" >/dev/null'
  bunx dotenvx run -f .env --overload -- \
    bash -c '
      status="$(curl --silent --show-error --output /dev/null --write-out "%{http_code}" "${APP_DOMAIN%/}/api/chat/deployment-routing-probe")"
      if [[ "$status" != 404 ]]; then
        echo "Public /api/chat route bypasses the web service: expected HTTP 404, got $status" >&2
        exit 1
      fi
    '

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

test-donations: install
  go test ./apps/donations ./internal/donations ./internal/donationalerts

test-video: install
  go test ./apps/video ./internal/videoingest ./internal/money ./internal/youtube

test-chat: install
  go test ./apps/chat ./internal/chat

test-packages: install
  bunx dotenvx run -f .env --overload -- bunx vitest --run packages

test: test-web test-chat test-donations test-video test-packages

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
