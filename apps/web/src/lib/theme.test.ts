import { describe, expect, it } from "vitest";

import { resolveTheme } from "./theme";

describe("resolveTheme", () => {
  it("uses the persisted dark theme", () => {
    expect(resolveTheme("dark")).toBe("dark");
  });

  it("falls back to the light theme for absent or invalid values", () => {
    expect(resolveTheme(null)).toBe("light");
    expect(resolveTheme("system")).toBe("light");
  });
});
