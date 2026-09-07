import { existsSync } from "node:fs";

import { expect, it } from "vitest";

it("does not contain vite.config.js alongside vite.config.ts", () => {
  expect(existsSync(new URL("../vite.config.js", import.meta.url))).toBe(false);
});
