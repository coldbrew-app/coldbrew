import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";
import { dirname } from "node:path";

import { $, file } from "bun";

const currentWorktree = await realpath(".");
const commonDir = (await $`git rev-parse --path-format=absolute --git-common-dir`.text()).trimEnd();
const primaryWorktree = await realpath(dirname(commonDir));
assert.equal(
  currentWorktree,
  primaryWorktree,
  `Run just dev-cleanup from the primary checkout: ${primaryWorktree}`,
);
assert(
  await file(".env").exists(),
  "The primary checkout has no .env file; run just env-init first",
);
await $`bunx dotenvx run -f .env --overload -- just _dev-cleanup-validate`;
const runningServices = (
  await $`bunx dotenvx run -f .env --overload -- docker compose -f compose.dev.yaml ps --status running --services`.text()
).split("\n");
const infraWasRunning = ["postgres", "nats"].every((service) => runningServices.includes(service));

await $`git worktree prune`;
const records = (await $`git worktree list --porcelain -z`.text()).split("\0\0").filter(Boolean);
const worktrees = records
  .map((record) => {
    const fields = record.split("\0");
    const path = fields.find((field) => field.startsWith("worktree "))?.slice(9) ?? "";
    assert.notEqual(path, "", "Git worktree record must contain a path");
    return {
      path,
      branch: fields.find((field) => field.startsWith("branch refs/heads/"))?.slice(18),
      locked: fields.some((field) => field === "locked" || field.startsWith("locked ")),
    };
  })
  .filter((worktree) => worktree.path !== primaryWorktree);

// Validate every worktree before removing any of them.
for (const { path, locked } of worktrees) {
  assert(!locked, `Refusing to remove locked worktree: ${path}`);
  assert.equal(
    await $`git -C ${path} status --porcelain`.text(),
    "",
    `Refusing to remove worktree with uncommitted changes: ${path}`,
  );
  const head = (await $`git -C ${path} rev-parse HEAD`.text()).trim();
  const merged = await $`git merge-base --is-ancestor ${head} HEAD`.nothrow();
  assert.equal(
    merged.exitCode,
    0,
    `Refusing to remove worktree whose HEAD is not merged into the primary branch: ${path}`,
  );
}

for (const { path, branch } of worktrees) {
  await $`git worktree remove --force ${path}`;
  if (branch) await $`git branch -d -- ${branch}`;
}
await $`git worktree prune`;

await $`just dev-infra-up`;
try {
  await $`bunx dotenvx run -f .env --overload -- just _dev-resources-cleanup`;
} finally {
  if (!infraWasRunning) await $`just dev-infra-down`;
}
