import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../env.js", () => ({
  env: {
    DONATIONS_SERVICE_SECRET: "test-donations-service-secret-32-characters",
    DONATIONS_SERVICE_URL: "http://donations.test",
  },
}));

import { donationAlertService, DonationAlertServiceError } from "./client.js";

afterEach(() => vi.unstubAllGlobals());

const settings = {
  enabled: true,
  paused: true,
  enabledSources: ["donationalerts" as const],
  displayDurationMs: 6_000,
  soundVolume: 70,
  ttsEnabled: true,
  ttsVoice: "ru",
  ttsVolume: 80,
  accentColor: "#ffbd3e",
  imageAssetId: null,
  soundAssetId: null,
};

function requestBody(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>, call = 0) {
  const body = fetchMock.mock.calls[call]?.[1]?.body;
  if (typeof body !== "string") throw new TypeError("Expected a JSON string request body.");
  return JSON.parse(body) as unknown;
}

describe("donation alert service client", () => {
  it("authenticates settings updates and keeps pause on its dedicated endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(null));
    vi.stubGlobal("fetch", fetchMock);

    await donationAlertService.updateSettings(42, settings);

    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://donations.test/internal/alerts/settings");
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.headers).toEqual({
      Authorization: "Bearer test-donations-service-secret-32-characters",
      "Content-Type": "application/json",
    });
    expect(requestBody(fetchMock)).toEqual({
      userId: 42,
      enabled: true,
      enabledSources: ["donationalerts"],
      displayDurationMs: 6_000,
      soundVolume: 70,
      ttsEnabled: true,
      ttsVoice: "ru",
      ttsVolume: 80,
      accentColor: "#ffbd3e",
      imageAssetId: null,
      soundAssetId: null,
    });
  });

  it("authorizes media with an overlay token in the private request body", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("media", { headers: { "Content-Type": "image/png" } }));
    vi.stubGlobal("fetch", fetchMock);

    await donationAlertService.asset("64fb569a-95bb-4d1a-a6ad-765b0f2d5702", {
      token: "t".repeat(32),
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://donations.test/internal/alerts/asset/read");
    expect(requestBody(fetchMock)).toEqual({
      assetId: "64fb569a-95bb-4d1a-a6ad-765b0f2d5702",
      token: "t".repeat(32),
    });
  });

  it("streams validated NDJSON through a POST without putting the token in the URL", async () => {
    const playback = {
      playbackId: "64fb569a-95bb-4d1a-a6ad-765b0f2d5702",
      donationId: "9007199254740993",
      kind: "test",
      state: "pending",
      source: "donationalerts",
      author: "Viewer",
      message: "Coffee!",
      amount: "10.00",
      currency: "USD",
      imageAssetId: null,
      soundAssetId: null,
      ttsAssetId: null,
      displayDurationMs: 5_000,
      soundVolume: 70,
      ttsVolume: 80,
      accentColor: "#ffbd3e",
      createdAt: "2026-09-13T10:00:00Z",
      startedAt: null,
      finishedAt: null,
      detail: null,
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        `${JSON.stringify({ type: "playback", playback })}\n${JSON.stringify({ type: "keepalive" })}\n`,
        {
          headers: { "Content-Type": "application/x-ndjson" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    const events = [];
    for await (const event of donationAlertService.streamOverlay(
      "s".repeat(32),
      "6a9cabbb-d675-40f5-a248-c40558f75d58",
      3,
      controller.signal,
    )) {
      events.push(event);
    }

    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe("playback");
    if (events[0]?.type === "playback") {
      expect(events[0].playback.donationId).toBe(9_007_199_254_740_993n);
    }
    expect(events[1]).toEqual({ type: "keepalive" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://donations.test/internal/alerts/overlay/stream",
    );
    expect(requestBody(fetchMock)).toEqual({
      token: "s".repeat(32),
      playerId: "6a9cabbb-d675-40f5-a248-c40558f75d58",
      generation: 3,
    });
  });

  it("reports only a bounded renderer diagnostic code with the player identity", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(null));
    vi.stubGlobal("fetch", fetchMock);

    await donationAlertService.diagnostic(
      "s".repeat(32),
      "6a9cabbb-d675-40f5-a248-c40558f75d58",
      3,
      "64fb569a-95bb-4d1a-a6ad-765b0f2d5702",
      "sound_unavailable",
    );

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://donations.test/internal/alerts/overlay/diagnostic",
    );
    expect(requestBody(fetchMock)).toEqual({
      token: "s".repeat(32),
      playerId: "6a9cabbb-d675-40f5-a248-c40558f75d58",
      generation: 3,
      playbackId: "64fb569a-95bb-4d1a-a6ad-765b0f2d5702",
      code: "sound_unavailable",
    });
  });

  it("forwards acknowledgement cancellation to the private service fetch", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(null));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await donationAlertService.heartbeat(
      "s".repeat(32),
      "6a9cabbb-d675-40f5-a248-c40558f75d58",
      3,
      true,
      true,
      controller.signal,
    );

    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });

  it("translates malformed upstream events into the typed service error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(new Response('{"untrusted":true}\n')),
    );
    const collect = async () => {
      for await (const _event of donationAlertService.streamOverlay(
        "s".repeat(32),
        "6a9cabbb-d675-40f5-a248-c40558f75d58",
        3,
        new AbortController().signal,
      )) {
        // Consume the full stream so decoding errors reach the caller.
      }
    };

    const failure = collect();
    await expect(failure).rejects.toBeInstanceOf(DonationAlertServiceError);
    await expect(failure).rejects.toMatchObject({
      name: "DonationAlertServiceError",
      detail: "validation error",
    });
  });
});
