#!/usr/bin/env -S bun --no-env-file
import assert from "node:assert/strict";
import { parseEnv } from "node:util";

// Minimal dotenvx substitute for the environment recipe's integration test.
import { file, write } from "bun";

const [tool, command, ...args] = process.argv.slice(2);
assert.equal(tool, "dotenvx");
const envFile = args[args.indexOf("-f") + 1];
const read = async () => parseEnv(await file(envFile).text());
switch (command) {
  case "decrypt":
    process.stdout.write(await file(envFile).text());
    break;
  case "set": {
    const [key, value] = args.slice(args.indexOf("--plain") + 1);
    const values = { ...(await read()), [key]: value };
    await write(
      envFile,
      Object.entries(values)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}\n`)
        .join(""),
    );
    break;
  }
  case "get":
    assert(args.includes("--overload"));
    process.stdout.write(JSON.stringify({ ...process.env, ...(await read()) }));
    break;
  default:
    throw new Error(`Unexpected dotenvx command: ${command}`);
}
