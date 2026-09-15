import { afterEach, describe, expect, it, vi } from "vitest";

const { authorizePublisher, endSession, heartbeat } = vi.hoisted(() => ({
  authorizePublisher: vi.fn(),
  endSession: vi.fn(),
  heartbeat: vi.fn(),
}));
vi.mock("../env.js", () => ({
  env: { RESTREAM_MEDIA_SHARED_SECRET: "test-restream-media-secret-32-characters" },
}));
vi.mock("./index.js", () => ({
  restreamStore: { authorizePublisher, endSession, heartbeat },
}));

import { handleRestreamMedia } from "./http.js";

const destinationId = "02c45e23-ccdd-4fec-9926-cba06a1b68f7";
const sessionId = "8ddf5b1b-e236-49a7-a666-502ee8671f7e";
const authorization = "Bearer test-restream-media-secret-32-characters";

function mediaRequest(body: unknown, token = authorization) {
  return new Request("https://streambrew.test/api/restream/media", {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => vi.resetAllMocks());

describe("restream media HTTP boundary", () => {
  it("rejects unauthorized requests before parsing or database access", async () => {
    const response = await handleRestreamMedia(mediaRequest({ type: "authorize" }, "Bearer no"));

    expect(response.status).toBe(401);
    expect(authorizePublisher).not.toHaveBeenCalled();
  });

  it("authorizes a validated publisher and returns only its ephemeral targets", async () => {
    authorizePublisher.mockResolvedValue({
      sessionId,
      destinations: [
        {
          destinationId,
          targetUrl: "rtmps://live.example.com/app#destination-secret",
        },
      ],
    });
    const response = await handleRestreamMedia(
      mediaRequest({
        type: "authorize",
        nodeId: "fsn1-1",
        publisherId: "publisher-1",
        path: `sb_${"a".repeat(43)}`,
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ sessionId });
    expect(authorizePublisher).toHaveBeenCalledWith(
      "fsn1-1",
      "publisher-1",
      `sb_${"a".repeat(43)}`,
    );
  });

  it("rejects unknown ingest keys without exposing which part failed", async () => {
    authorizePublisher.mockResolvedValue(null);
    const response = await handleRestreamMedia(
      mediaRequest({
        type: "authorize",
        nodeId: "fsn1-1",
        publisherId: "publisher-1",
        path: `sb_${"a".repeat(43)}`,
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Publisher is not authorized" });
  });

  it("updates destination state only for the authenticated media node", async () => {
    heartbeat.mockResolvedValue(true);
    const response = await handleRestreamMedia(
      mediaRequest({
        type: "heartbeat",
        nodeId: "fsn1-1",
        sessionId,
        destinations: [{ destinationId, state: "forwarding", outboundBytes: 2048 }],
      }),
    );

    expect(response.status).toBe(204);
    expect(heartbeat).toHaveBeenCalledWith("fsn1-1", sessionId, [
      { destinationId, state: "forwarding", outboundBytes: 2048 },
    ]);
  });

  it("rejects invalid and oversized media requests", async () => {
    const invalid = await handleRestreamMedia(mediaRequest({ type: "unknown" }));
    const oversized = await handleRestreamMedia(
      mediaRequest({ type: "ended", padding: "x".repeat(17 * 1024) }),
    );

    expect(invalid.status).toBe(400);
    expect(oversized.status).toBe(413);
  });
});
