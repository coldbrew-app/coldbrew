import { describe, expect, it } from "vitest";

import {
  RestreamConfigSchema,
  RestreamMediaAuthorizeRequestSchema,
  RestreamMediaAuthorizeResponseSchema,
  RestreamServerUrlSchema,
  RestreamStreamKeySchema,
} from "./restream.js";

const ingestKey = `sb_${"a".repeat(43)}`;
const destinationId = "02c45e23-ccdd-4fec-9926-cba06a1b68f7";
const sessionId = "8ddf5b1b-e236-49a7-a666-502ee8671f7e";

describe("restream schemas", () => {
  it("accepts RTMP and RTMPS destinations while rejecting web URLs", () => {
    expect(RestreamServerUrlSchema.safeParse("rtmp://live.example.com/app").success).toBe(true);
    expect(RestreamServerUrlSchema.safeParse("rtmps://live.example.com:443/app").success).toBe(
      true,
    );
    expect(RestreamServerUrlSchema.safeParse("https://live.example.com/app").success).toBe(false);
    expect(RestreamServerUrlSchema.safeParse("rtmp://live.example.com/app#secret").success).toBe(
      false,
    );
  });

  it("rejects stream keys that cannot be represented by MediaMTX", () => {
    expect(RestreamStreamKeySchema.safeParse("live_key?bandwidthtest=true").success).toBe(true);
    expect(RestreamStreamKeySchema.safeParse("key with spaces").success).toBe(false);
    expect(RestreamStreamKeySchema.safeParse("key#fragment").success).toBe(false);
  });

  it("validates the browser-safe configuration without destination credentials", () => {
    const config = RestreamConfigSchema.parse({
      ingest: { serverUrl: "rtmp://restream.example.com:1935", streamKey: ingestKey },
      destinations: [
        {
          destinationId,
          platform: "youtube",
          label: "Main YouTube",
          serverUrl: "rtmps://a.rtmp.youtube.com/live2",
          streamKeyHint: "cdef",
          enabled: true,
          position: 0,
        },
      ],
      session: {
        sessionId,
        status: "live",
        startedAt: "2026-09-15T12:00:00Z",
        liveAt: "2026-09-15T12:00:01Z",
        lastHeartbeatAt: "2026-09-15T12:00:05Z",
        destinations: [{ destinationId, state: "forwarding", outboundBytes: 1024 }],
      },
      plan: { status: "beta", monthlyPriceUsdCents: 1999, maxDestinations: 3 },
    });

    expect(config.session?.startedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(config)).not.toContain("stream-secret");
  });

  it("keeps the Go media-plane wire contract narrow", () => {
    expect(
      RestreamMediaAuthorizeRequestSchema.parse({
        type: "authorize",
        nodeId: "fsn1-1",
        publisherId: "publisher-1",
        path: ingestKey,
      }),
    ).toBeDefined();
    expect(
      RestreamMediaAuthorizeResponseSchema.parse({
        sessionId,
        destinations: [
          {
            destinationId,
            targetUrl: "rtmps://a.rtmp.youtube.com/live2#stream-secret",
          },
        ],
      }),
    ).toBeDefined();
  });
});
