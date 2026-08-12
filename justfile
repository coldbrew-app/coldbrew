[default]
default:
  @just --list

install:
  pnpm install

dev-server:
  pnpm exec dotenvx run -- pnpm exec tsx --watch apps/server/src/index.ts

dev-donationalerts:
  pnpm exec dotenvx run -- pnpm exec tsx --watch apps/donationalerts/src/index.ts

dev-video:
  pnpm exec dotenvx run -- pnpm exec tsx --watch apps/video/src/index.ts

dev-client:
  cd apps/client && pnpm exec vite

dev:
  pnpm exec concurrently -n 'client,server,donationalerts,video' 'just dev-client' 'just dev-server' 'just dev-donationalerts' 'just dev-video'

typecheck-client:
  pnpm exec tsc --noEmit -p apps/client/tsconfig.json

typecheck-server:
  pnpm exec tsc --noEmit -p apps/server/tsconfig.json

typecheck-donationalerts:
  pnpm exec tsc --noEmit -p apps/donationalerts/tsconfig.json

typecheck-video:
  pnpm exec tsc --noEmit -p apps/video/tsconfig.json

typecheck-packages:
  pnpm exec tsc --noEmit -p packages/tsconfig.json

typecheck: typecheck-client typecheck-server typecheck-donationalerts typecheck-video typecheck-packages


fmt:
  pnpm exec oxfmt

fmt-check:
  pnpm exec oxfmt --check


build-client: install
  cd client && pnpm exec vite build && pnpm exec tsc

test-client: install
  cd apps/client && pnpm exec vitest --run --passWithNoTests

test-server: install
  pnpm exec dotenvx run -- pnpm exec vitest --run --passWithNoTests apps/server

test-donationalerts: install
  pnpm exec dotenvx run -- pnpm exec vitest --run --passWithNoTests apps/donationalerts

test-video: install
  pnpm exec dotenvx run -- pnpm exec vitest --run --passWithNoTests apps/video

test-packages: install
  pnpm exec dotenvx run -- pnpm exec vitest --run --passWithNoTests packages

test: test-server test-donationalerts test-video test-packages test-client

lint: test fmt-check


schema-apply:
  pgschema apply --file db/schema.sql

schema-reset:
  yes | pgschema apply --file db/empty.sql
  yes | just schema-apply


count-lines path=".":
  find "{{path}}" -type d -name "node_modules" -prune -o -type f \( -name "*.ts" -o -name "*.tsx" \) -print0 | xargs -0 wc -l
