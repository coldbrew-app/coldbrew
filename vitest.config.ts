import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    passWithNoTests: true,
    tags: [
      { name: "integration", description: "Integration tests" },
      { name: "unit", description: "Unit tests" },
    ],
  },
});
