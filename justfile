[default]
default:
  @just --list

install:
  pnpm install

dev-donationalerts:
  pnpm exec dotenvx run -- pnpm exec tsx --watch apps/donationalerts/src/index.ts

dev-video:
  pnpm exec dotenvx run -- pnpm exec tsx --watch apps/video/src/index.ts

dev-web:
  pnpm exec dotenvx run -- pnpm --filter @omnistream/web dev

dev:
  pnpm exec concurrently -n 'web,donationalerts,video' 'just dev-web' 'just dev-donationalerts' 'just dev-video'

typecheck-web:
  pnpm exec tsc --noEmit -p apps/web/tsconfig.json

typecheck-donationalerts:
  pnpm exec tsc --noEmit -p apps/donationalerts/tsconfig.json

typecheck-video:
  pnpm exec tsc --noEmit -p apps/video/tsconfig.json

typecheck-packages:
  pnpm exec tsc --noEmit -p packages/tsconfig.json

typecheck: typecheck-web typecheck-donationalerts typecheck-video typecheck-packages


fmt:
  pnpm exec oxfmt

fmt-check:
  pnpm exec oxfmt --check


build-web: install
  cd apps/web && pnpm exec vite build

test-web: install
  pnpm exec dotenvx run -- pnpm exec vitest --run apps/web

test-donationalerts: install
  pnpm exec dotenvx run -- pnpm exec vitest --run apps/donationalerts

test-video: install
  pnpm exec dotenvx run -- pnpm exec vitest --run apps/video

test-packages: install
  pnpm exec dotenvx run -- pnpm exec vitest --run packages

test: test-web test-donationalerts test-video test-packages

lint: test fmt-check

schema-apply:
  pgschema apply --auto-approve --file db/schema.sql

schema-reset:
  pnpm exec dotenvx run -- psql -v ON_ERROR_STOP=1 --command 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
  just schema-apply


count-lines path=".":
  find "{{path}}" -type d -name "node_modules" -prune -o -type f \( -name "*.ts" -o -name "*.tsx" \) -print0 | xargs -0 wc -l
