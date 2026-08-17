[default]
default:
  @just --list

install:
  bun install

dev-donationalerts:
  bunx dotenvx run -- bun --watch apps/donationalerts/src/index.ts

dev-video:
  bunx dotenvx run -- bun --watch apps/video/src/index.ts

dev-web:
  bunx dotenvx run -- sh -c 'cd apps/web && bun run dev'

dev:
  bunx concurrently -n 'web,donationalerts,video' 'just dev-web' 'just dev-donationalerts' 'just dev-video'

typecheck-web:
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


build-web: install
  cd apps/web && bunx vite build

test-web: install
  bunx dotenvx run -- bunx vitest --run apps/web

test-donationalerts: install
  bunx dotenvx run -- bunx vitest --run apps/donationalerts

test-video: install
  bunx dotenvx run -- bunx vitest --run apps/video

test-packages: install
  bunx dotenvx run -- bunx vitest --run packages

test: test-web test-donationalerts test-video test-packages

check: test fmt-check

schema-apply:
  pgschema apply --auto-approve --file db/schema.sql

schema-reset:
  pgschema apply --auto-approve --file db/empty.sql
  just schema-apply


count-lines path=".":
  cloc --vcs=git --not-match-f='^(package\.json|bun\.lock)$' "{{path}}"
