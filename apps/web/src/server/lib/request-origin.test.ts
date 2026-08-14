import { describe, expect, it } from "vitest";

import { getRequestOrigin } from "./request-origin";

describe("getRequestOrigin", () => {
  it("returns the origin from the active request URL", () => {
    const request = new Request("https://preview.omnistream.example/api/trpc/authUrls");

    expect(getRequestOrigin(request)).toBe("https://preview.omnistream.example");
  });

  it("preserves the development protocol and port", () => {
    const request = new Request("http://localhost:3000/api/integration/donationalerts/callback");

    expect(getRequestOrigin(request)).toBe("http://localhost:3000");
  });
});
