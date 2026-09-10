[default]
default:
  @just --list

install:
  bun install

# Build the runtime environment for the current worktree from long-lived dev settings.
env-init $source_env=".env.dev":
  bun --no-env-file scripts/env-init.ts "$source_env"

# Prepare a new T3 Code worktree from the project's primary checkout.
[script("bash", "-euo", "pipefail")]
t3-worktree-init $source_worktree:
  if [[ ! -f "$source_worktree/.env.keys" ]]; then
    echo "Source worktree has no .env.keys file: $source_worktree" >&2
    exit 1
  fi

  cp -p "$source_worktree/.env.keys" .env.keys
  just env-init
  bun install
  just dev-db-up
  just dev-db-copy "$source_worktree"
  just db-migrate

dev-donations:
  bunx dotenvx run -f .env --overload -- go run ./apps/donations

video-titles-backfill:
  bunx dotenvx run -f .env --overload -- go run ./apps/video --backfill-titles

dev-video:
  bunx dotenvx run -f .env --overload -- go run ./apps/video

dev-chat:
  bunx dotenvx run -f .env --overload -- go run ./apps/chat

dev-alerts:
  bunx dotenvx run -f .env --overload -- go run ./apps/alerts

dev-web:
  bunx dotenvx run -f .env --overload -- sh -c 'cd apps/web && bun run dev'

dev:
  bunx concurrently -n 'web,chat,donations,video' 'just dev-web' 'just dev-chat' 'just dev-donations' 'just dev-video'

typecheck-web:
  bunx tsc --noEmit -p apps/web/tsconfig.node.json
  bunx tsc --noEmit -p apps/web/tsconfig.json

typecheck-go:
  go build ./apps/... ./internal/...

typecheck-packages:
  bunx tsc --noEmit -p packages/tsconfig.json

typecheck-scripts:
  bunx tsc --noEmit -p scripts/tsconfig.json

typecheck: typecheck-scripts typecheck-web typecheck-go typecheck-packages


fmt-sql:
  bun scripts/format-sql.ts db/schema.sql db/migrations/*.sql

fmt: fmt-sql
  bunx oxfmt
  go fmt ./...

fmt-check-sql:
  bun scripts/format-sql.ts --check db/schema.sql db/migrations/*.sql

fmt-check: fmt-check-sql
  bunx oxfmt --check
  gofmt -l apps internal | awk '{ print; found = 1 } END { exit found }'

lint-ts:
  bunx oxlint

[script("bash", "-euo", "pipefail")]
lint-go:
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

lint-fallow:
  bunx fallow dead-code --fail-on-issues

lint: fmt-check lint-ts lint-go lint-fallow

build-web: install
  cd apps/web && bunx vite build

[script("bash", "-euo", "pipefail")]
generate-youtube-chat-go-proto:
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
  docker compose up -d --remove-orphans

# Show running containers in a terminal-friendly table capped at 150 columns.
docker-ps:
  @docker ps --format 'table {{ "{{" }}.Names{{ "}}" }}\t{{ "{{" }}.Status{{ "}}" }}\t{{ "{{" }}.Ports{{ "}}" }}' | sed -E 's/, \[::\]:[0-9]+->[0-9]+\/(tcp|udp)//g' | cut -c1-150

# Pull immutable production images, recreate the stack, and verify the public endpoint.
[script("bash", "-euo", "pipefail")]
production-deploy $app_image $postgres_image:
  export COLDBREW_IMAGE="$app_image"
  export COLDBREW_POSTGRES_IMAGE="$postgres_image"

  # Keep manual Compose operations and host restarts on the deployed immutable images.
  bunx dotenvx set -f .env --plain COLDBREW_IMAGE "$COLDBREW_IMAGE"
  bunx dotenvx set -f .env --plain COLDBREW_POSTGRES_IMAGE "$COLDBREW_POSTGRES_IMAGE"

  docker compose pull postgres web
  docker compose up --no-build --detach --wait --wait-timeout 180 --remove-orphans
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

# Start the repository-wide PostgreSQL and NATS development infrastructure.
dev-infra-up:
  bunx dotenvx run -f .env --overload -- bun --no-env-file scripts/dev-infra-up.ts

# Create the current worktree's logical database in the shared PostgreSQL server.
dev-db-up: dev-infra-up
  bunx dotenvx run -f .env --overload -- bun --no-env-file scripts/dev-db-up.ts

[script("bash", "-euo", "pipefail")]
dev-db-copy $source_worktree:
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
    bunx dotenvx run -f .env --overload -- bash -eu -o pipefail -c \
      'docker compose -f compose.dev.yaml exec -T postgres psql --username="$PGUSER" --dbname="$PGDATABASE" --command="SELECT 1" >/dev/null'
  ); then
    echo "Source development database is not running: $source_worktree" >&2
    exit 1
  fi

  dump_path="$(mktemp "${TMPDIR:-/tmp}/coldbrew-dev-db.XXXXXX.dump")"
  trap 'rm -f "$dump_path"' EXIT

  (
    cd "$source_worktree"
    bunx dotenvx run -f .env --overload -- bash -eu -o pipefail -c \
      'docker compose -f compose.dev.yaml exec -T postgres pg_dump --format=custom --no-owner --no-privileges --username="$PGUSER" --dbname="$PGDATABASE"'
  ) > "$dump_path"

  bunx dotenvx run -f .env --overload -- bash -eu -o pipefail -c \
    'docker compose -f compose.dev.yaml exec -T postgres pg_restore --clean --if-exists --no-owner --no-privileges --single-transaction --exit-on-error --username="$PGUSER" --dbname="$PGDATABASE"' \
    < "$dump_path"

# Stop the shared infrastructure. This affects every Coldbrew worktree.
dev-infra-down:
  bunx dotenvx run -f .env --overload -- docker compose -f compose.dev.yaml down

# Destroy all shared development databases and NATS state.
[confirm("Destroy shared Coldbrew development infrastructure for every worktree?")]
dev-infra-destroy:
  bunx dotenvx run -f .env --overload -- docker compose -f compose.dev.yaml down --volumes

# Remove every clean, merged secondary worktree and its local development resources.
[confirm("Remove all clean, merged secondary worktrees, their local branches, databases, and NATS namespaces?")]
dev-cleanup:
  bun --no-env-file scripts/dev-cleanup.ts

[private]
_dev-cleanup-validate:
  bun --no-env-file scripts/dev-cleanup-validate.ts

[private]
_dev-resources-cleanup: _dev-cleanup-validate
  bun --no-env-file scripts/dev-resources-cleanup.ts

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

test-alerts: install
  go test ./apps/alerts ./internal/alerts ./internal/observability

test-scripts: install
  bun --no-env-file x --bun vitest --run scripts

test-packages $env_file=".env": install
  bunx dotenvx run -f $env_file --overload -- bunx vitest --run packages

test: test-scripts test-web test-chat test-donations test-video test-alerts test-packages

check: lint test

db-migrate $env_file=".env":
  bunx dotenvx run -f $env_file --overload -- bunx dbmate up
  @just fmt-sql

db-migration-new name:
  bunx dbmate new {{quote(name)}}

db-migration-status $env_file=".env":
  bunx dotenvx run -f $env_file --overload -- bunx dbmate status

db-dump $env_file=".env":
  bunx dotenvx run -f $env_file --overload -- bunx dbmate dump
  @just fmt-sql

[confirm("Drop and recreate the configured database?")]
db-reset $env_file=".env":
  bunx dotenvx run -f $env_file --overload -- bunx dbmate drop
  bunx dotenvx run -f $env_file --overload -- bunx dbmate up


# Count production code and TypeScript tests in one report.
count-lines $target_path=".":
  cloc --config .config/cloc-options.txt "$target_path"

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
