import assert from "node:assert/strict";
import { chmod, cp, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";

import { $, file, write } from "bun";

const directory = await mkdtemp(join(tmpdir(), "coldbrew-env-test-"));
const primary = join(directory, "primary checkout");
const worktrees = [primary, join(directory, "worktree-one"), join(directory, "worktree-two")];
const bin = join(directory, "bin");
const environment = {
  ...process.env,
  PATH: `${bin}:${process.env["PATH"]}`,
  PGUSER: "inherited",
  PGPASSWORD: "inherited",
};
const read = async (path: string) => parseEnv(await file(join(path, ".env")).text());
const initialize = (path: string, args: string[] = []) =>
  $`just env-init ${args}`.cwd(path).env(environment).quiet();
const sharedKeys = ["COMPOSE_PROJECT_NAME", "PGPORT", "NATS_PORT"];
const isolatedKeys = ["PGDATABASE", "APP_PORT", "CHAT_PORT", "DONATIONS_PORT", "NATS_NAMESPACE"];

try {
  await mkdir(bin);
  await mkdir(primary);
  await cp("scripts/fixtures/bunx.ts", join(bin, "bunx"));
  await chmod(join(bin, "bunx"), 0o755);
  await $`git -C ${primary} init --quiet`.quiet();
  await $`git -C ${primary} -c user.name=Test -c user.email=test@example.com -c commit.gpgsign=false -c core.hooksPath=/dev/null commit --quiet --allow-empty -m init`.quiet();
  for (const [index, path] of worktrees.slice(1).entries()) {
    await $`git -C ${primary} -c core.hooksPath=/dev/null worktree add --quiet -b ${`feature/${index}`} ${path}`.quiet();
  }
  for (const path of worktrees) {
    await cp("justfile", join(path, "justfile"));
    await cp("scripts", join(path, "scripts"), { recursive: true });
    await write(join(path, ".env.dev"), "PGUSER=test\nPGPASSWORD=test\nPGSSLMODE=require\n");
    await initialize(path);
  }

  const environments = await Promise.all(worktrees.map(read));
  for (const key of sharedKeys) {
    assert.equal(new Set(environments.map((env) => env[key])).size, 1, `${key} must be shared`);
  }
  for (const key of isolatedKeys) {
    assert.equal(new Set(environments.map((env) => env[key])).size, 3, `${key} must be isolated`);
  }
  for (const [index, path] of worktrees.entries()) {
    const env = environments[index];
    assert.equal(env["PGHOST"], "127.0.0.1");
    assert.equal(env["PGSSLMODE"], "disable");
    assert.equal(
      env["DATABASE_URL"],
      `postgresql://test:test@127.0.0.1:${env["PGPORT"]}/${env["PGDATABASE"]}`,
    );
    assert.equal((await stat(join(path, ".env"))).mode & 0o777, 0o600);
    const before = await file(join(path, ".env")).text();
    await initialize(path);
    assert.equal(await file(join(path, ".env")).text(), before);
  }

  await $`git -C ${primary} config --local coldbrew.devComposeProject existing_shared_dev`;
  for (const path of worktrees) {
    await initialize(path);
    const env = await read(path);
    assert.equal(env["COMPOSE_PROJECT_NAME"], "existing_shared_dev");
    assert.equal(env["PGPORT"], environments[0]["PGPORT"]);
    assert.equal(env["NATS_PORT"], environments[0]["NATS_PORT"]);
  }
  await $`git -C ${primary} config --local coldbrew.devComposeProject INVALID`;
  assert.notEqual((await initialize(primary).nothrow()).exitCode, 0);
  await $`git -C ${primary} config --local --unset coldbrew.devComposeProject`;
  await $`git -C ${primary} checkout --quiet --detach`;
  await write(join(primary, "custom settings.env"), "PGUSER=custom\nPGPASSWORD=custom\n");
  await initialize(primary, ["custom settings.env"]);
  const detached = await read(primary);
  assert.match(detached["PGDATABASE"] ?? "", /^coldbrew_detached_[0-9a-f]+_[0-9a-f]{8}$/);
  assert(detached["DATABASE_URL"]?.startsWith("postgresql://custom:custom@"));
  console.log("Environment initialization is shared, isolated, and repeatable.");
} finally {
  await rm(directory, { recursive: true, force: true });
}
