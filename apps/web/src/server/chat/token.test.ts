import { describe, expect, it } from "vitest";

import { createOverlayToken, hashOverlayToken } from "./token";

describe("overlay tokens", () => {
  it("creates random URL-safe secrets and stores only a stable SHA-256 hash", () => {
    const first = createOverlayToken();
    const second = createOverlayToken();

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
    expect(hashOverlayToken(first)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashOverlayToken(first)).toBe(hashOverlayToken(first));
    expect(hashOverlayToken(second)).not.toBe(hashOverlayToken(first));
  });
});
