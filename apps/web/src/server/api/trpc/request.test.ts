import { describe, expect, it } from "vitest";

import { boundTrpcRequest } from "./request.js";

describe("tRPC request body boundary", () => {
  it("preserves bounded POST bodies for the tRPC adapter", async () => {
    const request = new Request("https://streambrew.test/api/trpc/alerts.openOverlay", {
      method: "POST",
      body: '{"token":"secret"}',
    });

    const bounded = await boundTrpcRequest(request);

    expect(bounded).toBeInstanceOf(Request);
    expect((bounded as Request).url).toBe(request.url);
    expect((bounded as Request).headers.get("content-length")).toBeNull();
    await expect((bounded as Request).text()).resolves.toBe('{"token":"secret"}');
  });

  it("rejects declared and streamed POST bodies over one MiB", async () => {
    const declared = await boundTrpcRequest(
      new Request("https://streambrew.test/api/trpc/alerts.openOverlay", {
        method: "POST",
        headers: { "Content-Length": String(1024 * 1024 + 1) },
      }),
    );
    const streamed = await boundTrpcRequest(
      new Request("https://streambrew.test/api/trpc/alerts.openOverlay", {
        method: "POST",
        headers: { "Content-Length": "1" },
        body: "x".repeat(1024 * 1024 + 1),
      }),
    );

    expect(declared).toBeInstanceOf(Response);
    expect((declared as Response).status).toBe(413);
    expect(streamed).toBeInstanceOf(Response);
    expect((streamed as Response).status).toBe(413);
  });

  it("does not consume GET requests", async () => {
    const request = new Request("https://streambrew.test/api/trpc/userInfo");

    await expect(boundTrpcRequest(request)).resolves.toBe(request);
  });
});
