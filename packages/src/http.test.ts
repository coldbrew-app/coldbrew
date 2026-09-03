import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { RequestError, requestJson, requestText } from "./http.js";

afterEach(() => vi.unstubAllGlobals());

describe("HTTP requests", () => {
  it("returns validated JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ id: 42 })),
    );

    await expect(requestJson("https://example.com", z.object({ id: z.number() }))).resolves.toEqual(
      { id: 42 },
    );
  });

  it("preserves an HTTP status on a typed error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Unauthorized", { status: 401 })),
    );

    await expect(requestText("https://example.com")).rejects.toMatchObject({
      name: RequestError.name,
      type: "http error",
      status: 401,
    });
  });

  it("distinguishes JSON decoding from schema validation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("not-json"))
      .mockResolvedValueOnce(Response.json({ id: "invalid" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestJson("https://example.com", z.object({ id: z.number() })),
    ).rejects.toMatchObject({ type: "invalid json" });
    await expect(
      requestJson("https://example.com", z.object({ id: z.number() })),
    ).rejects.toMatchObject({ type: "validation error" });
  });
});
