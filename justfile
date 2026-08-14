[default]
default:
  @just --list

install:
  nub install

dev-donationalerts:
  nubx dotenvx run -- nub --watch apps/donationalerts/src/index.ts

dev-video:
  nubx dotenvx run -- nub --watch apps/video/src/index.ts

dev-web:
  nubx dotenvx run -- sh -c 'cd apps/web && nub run dev'

dev:
  nubx concurrently -n 'web,donationalerts,video' 'just dev-web' 'just dev-donationalerts' 'just dev-video'

typecheck-web:
  nubx tsc --noEmit -p apps/web/tsconfig.json

typecheck-donationalerts:
  nubx tsc --noEmit -p apps/donationalerts/tsconfig.json

typecheck-video:
  nubx tsc --noEmit -p apps/video/tsconfig.json

typecheck-packages:
  nubx tsc --noEmit -p packages/tsconfig.json

typecheck: typecheck-web typecheck-donationalerts typecheck-video typecheck-packages


fmt:
  nubx oxfmt

fmt-check:
  nubx oxfmt --check


build-web: install
  cd apps/web && nubx vite build

test-web: install
  nubx dotenvx run -- nubx vitest --run apps/web

test-donationalerts: install
  nubx dotenvx run -- nubx vitest --run apps/donationalerts

test-video: install
  nubx dotenvx run -- nubx vitest --run apps/video

test-packages: install
  nubx dotenvx run -- nubx vitest --run packages

test: test-web test-donationalerts test-video test-packages

lint: test fmt-check

schema-apply:
  pgschema apply --auto-approve --file db/schema.sql

schema-reset:
  PGSSLMODE="require" PGSSLROOTCERT="system" nubx dotenvx run -- psql -v ON_ERROR_STOP=1 --command 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
  just schema-apply


count-lines path=".":
  find "{{path}}" -type d -name "node_modules" -prune -o -type f \( -name "*.ts" -o -name "*" \) -print0 | xargs -0 wc -l

dotenvx-test:
  pnpm add -g @dotenvx/dotenvx
  hyperfine --runs 5 'dotenvx run -q -- touch justfile'
  pnpm rm -g @dotenvx/dotenvx

  hyperfine --runs 5 'nubx dotenvx run -q -- touch justfile'
  hyperfine --runs 5 'pnpm dlx @dotenvx/dotenvx run -q -- touch justfile'
  hyperfine --runs 5 'pnpm exec dotenvx run -q -- touch justfile'
  hyperfine --runs 5 'bunx @dotenvx/dotenvx run -q -- touch justfile'
