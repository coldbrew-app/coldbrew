import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

it("does not contain vite.config.js alongside vite.config.ts", () => {
  expect(existsSync(fileURLToPath(import.meta.resolve("../vite.config.js")))).toBe(false);
});

it("does not contain a root CONTEXT.md", () => {
  expect(existsSync(fileURLToPath(import.meta.resolve("../../../CONTEXT.md")))).toBe(false);
});

it("runs production migrations inside a quoted remote script", () => {
  const workflow = readFileSync(
    fileURLToPath(import.meta.resolve("../../../.github/workflows/production.yml")),
    "utf8",
  );

  expect(workflow).not.toContain("ssh streambrew-production docker run");
  expect(workflow).toContain("exec docker run \\");
  expect(workflow).toContain('DATABASE_URL="${DATABASE_URL}?sslmode=disable" exec bunx dbmate');
});
