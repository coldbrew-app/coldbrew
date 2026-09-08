import assert from "node:assert/strict";

import { $ } from "bun";

const { PGUSER, PGDATABASE } = process.env;
assert(
  PGDATABASE && !/[^a-z0-9_]/.test(PGDATABASE),
  `Invalid development database name: ${PGDATABASE ?? ""}`,
);
assert(PGUSER !== undefined, "PGUSER is required");
// PGDATABASE is restricted to lowercase ASCII letters, digits, and underscores above.
const query = `SELECT 1 FROM pg_database WHERE datname = '${PGDATABASE}'`;
const exists =
  await $`docker compose -f compose.dev.yaml exec -T postgres psql --username=${PGUSER} --dbname=postgres --tuples-only --no-align --command=${query}`.text();
if (!exists.split("\n").includes("1")) {
  await $`docker compose -f compose.dev.yaml exec -T postgres createdb --username=${PGUSER} ${PGDATABASE}`;
}
