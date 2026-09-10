import assert from "node:assert/strict";
import { chmod, realpath } from "node:fs/promises";
import { basename, dirname } from "node:path";

import { $ } from "bun";

async function hashValue(value: string) {
  return (await $`git hash-object --stdin < ${Buffer.from(value)}`.text()).trim();
}

async function hashPort(value: string) {
  return 10000 + (Number.parseInt((await hashValue(value)).slice(0, 8), 16) % 40000);
}

function sanitizeName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const repository = await realpath((await $`git rev-parse --git-common-dir`.text()).trimEnd());
const branch =
  (await $`git branch --show-current`.text()).trimEnd() ||
  `detached_${(await $`git rev-parse --short HEAD`.text()).trim()}`;
const repositoryHash = (await hashValue(repository)).slice(0, 8);
const branchHash = (await hashValue(`${repository}:${branch}`)).slice(0, 8);
const suffix = `${sanitizeName(branch).slice(0, 40)}_${branchHash}`;
const override = await $`git config --local --get coldbrew.devComposeProject`.quiet().nothrow();
assert([0, 1].includes(override.exitCode), "Could not read coldbrew.devComposeProject Git setting");
const sharedProject = override.stdout.toString().replace(/\n+$/, "");
assert(
  !sharedProject || /^[a-z0-9][a-z0-9_-]*$/.test(sharedProject),
  "Invalid coldbrew.devComposeProject Git setting",
);

const appPort = await hashPort(`${repository}:${branch}:app`);
const chatPort = await hashPort(`${repository}:${branch}:chat`);
const donationsPort = await hashPort(`${repository}:${branch}:donations`);
const natsPort = await hashPort(`${repository}:nats`);
const settings = {
  APP_PORT: appPort,
  APP_DOMAIN: `http://localhost:${appPort}`,
  CHAT_PORT: chatPort,
  CHAT_PUBLIC_URL: `http://localhost:${appPort}/api/chat`,
  CHAT_SERVICE_URL: `http://127.0.0.1:${chatPort}`,
  CHAT_WEB_URL: `http://localhost:${appPort}`,
  DONATIONS_PORT: donationsPort,
  DONATIONS_SERVICE_URL: `http://127.0.0.1:${donationsPort}`,
  NATS_PORT: natsPort,
  NATS_SERVERS: `nats://127.0.0.1:${natsPort}`,
  NATS_NAMESPACE: `wt_${branchHash}`,
  PGHOST: "127.0.0.1",
  PGSSLMODE: "disable",
  PGPORT: await hashPort(`${repository}:db`),
  PGDATABASE: `coldbrew_${suffix}`,
  COMPOSE_PROJECT_NAME:
    sharedProject ||
    `${sanitizeName(basename(dirname(repository))).slice(0, 32)}_dev_${repositoryHash}`,
};

const source = process.argv[2] ?? ".env.dev";
await $`bunx dotenvx decrypt -f ${source} -fk .env.keys --stdout > .env`;
for (const [key, value] of Object.entries(settings)) {
  await $`bunx dotenvx set -f .env --plain ${key} ${String(value)}`;
}
const { PGUSER = "", PGPASSWORD = "" }: { PGUSER?: string; PGPASSWORD?: string } = JSON.parse(
  await $`bunx dotenvx get -f .env --overload --include-key PGUSER PGPASSWORD`.text(),
);
const databaseUrl = `postgresql://${PGUSER}:${PGPASSWORD}@${settings.PGHOST}:${settings.PGPORT}/${settings.PGDATABASE}?sslmode=${settings.PGSSLMODE}`;
await $`bunx dotenvx set -f .env --plain DATABASE_URL ${databaseUrl}`;
await chmod(".env", 0o600);
