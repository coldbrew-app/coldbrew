import { $ } from "bun";

const { PGUSER, PGDATABASE } = process.env;
const databases =
  await $`docker compose -f compose.dev.yaml exec -T postgres psql --username=${PGUSER} --dbname=postgres --tuples-only --no-align --command="SELECT datname FROM pg_database WHERE datname ~ '^coldbrew_[a-z0-9_]+$' ORDER BY datname"`.text();
for (const database of databases
  .split("\n")
  .filter((database) => database && database !== PGDATABASE)) {
  console.log(`Removing development database: ${database}`);
  await $`docker compose -f compose.dev.yaml exec -T postgres dropdb --force --if-exists --username=${PGUSER} ${database}`;
}
await $`go run ./cmd/dev-cleanup`;
