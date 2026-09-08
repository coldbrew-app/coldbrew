import assert from "node:assert/strict";

import { $ } from "bun";

const ports = [
  { service: "postgres", internal: 5432, host: process.env["PGPORT"] },
  { service: "nats", internal: 4222, host: process.env["NATS_PORT"] },
];
await $`docker compose -f compose.dev.yaml up -d --wait`;
for (const { service, internal, host } of ports) {
  const published = (
    await $`docker compose -f compose.dev.yaml port ${service} ${internal}`.text()
  ).trimEnd();
  assert.equal(
    published,
    `127.0.0.1:${host}`,
    `Unexpected ${service} port mapping: ${published}; expected 127.0.0.1:${host}. Check COMPOSE_PROJECT_NAME and regenerate the workspace environment with just env-init.`,
  );
}
