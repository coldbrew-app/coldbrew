import { afterEach, describe, expect, it, vi } from "vitest";

const { asset, getUserId, streamOverlay, uploadAsset } = vi.hoisted(() => ({
  asset: vi.fn(),
  getUserId: vi.fn(),
  streamOverlay: vi.fn(),
  uploadAsset: vi.fn(),
}));

vi.mock("@streambrew/packages/server-logger.js", () => ({ logError: vi.fn() }));
vi.mock("../api/_util.js", () => ({ getUserId }));
vi.mock("../env.js", () => ({ env: { APP_DOMAIN: "https://streambrew.test" } }));
vi.mock("./client.js", () => ({
  donationAlertService: { asset, streamOverlay, uploadAsset },
  DonationAlertServiceError: class DonationAlertServiceError extends Error {
    readonly status?: number;

    constructor(_detail: string, options: ErrorOptions & { status?: number } = {}) {
      super("Donation alert service error", options);
      this.status = options.status;
    }
  },
}));

import { DonationAlertServiceError } from "./client.js";
import { handleAlertMedia, handleAlertStream, handleAlertUpload } from "./http.js";

afterEach(() => vi.resetAllMocks());

describe("donation alert HTTP boundary", () => {
  it("rejects cross-origin multipart bodies before authentication or parsing", async () => {
    const request = new Request("https://streambrew.test/api/alerts/upload", {
      method: "POST",
      headers: {
        "Content-Length": "1024",
        "Content-Type": "multipart/form-data; boundary=unused",
        Origin: "https://evil.test",
        "X-StreamBrew-Upload": "1",
      },
      body: "not parsed",
    });

    const response = await handleAlertUpload(request);

    expect(response.status).toBe(403);
    expect(getUserId).not.toHaveBeenCalled();
    expect(uploadAsset).not.toHaveBeenCalled();
  });

  it("rejects oversized bodies before parsing multipart data", async () => {
    const response = await handleAlertUpload(
      new Request("https://streambrew.test/api/alerts/upload", {
        method: "POST",
        headers: {
          "Content-Length": String(12 * 1024 * 1024),
          Origin: "https://streambrew.test",
          "X-StreamBrew-Upload": "1",
        },
      }),
    );

    expect(response.status).toBe(413);
    expect(getUserId).not.toHaveBeenCalled();
  });

  it("rejects a streamed multipart body that exceeds its declared length", async () => {
    getUserId.mockResolvedValue(42);
    const response = await handleAlertUpload(
      new Request("https://streambrew.test/api/alerts/upload", {
        method: "POST",
        headers: {
          "Content-Length": "1",
          "Content-Type": "multipart/form-data; boundary=unused",
          Origin: "https://streambrew.test",
          "X-StreamBrew-Upload": "1",
        },
        body: new Uint8Array(11 * 1024 * 1024 + 1),
      }),
    );

    expect(response.status).toBe(413);
    expect(uploadAsset).not.toHaveBeenCalled();
  });

  it("rejects concurrent uploads before buffering the second body", async () => {
    getUserId.mockResolvedValue(42);
    let finishUpload: () => void = () => undefined;
    uploadAsset.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishUpload = () => resolve({ assetId: crypto.randomUUID() });
        }),
    );
    const createRequest = () => {
      const form = new FormData();
      form.set("kind", "image");
      form.set("file", new File(["png"], "alert.png", { type: "image/png" }));
      return new Request("https://streambrew.test/api/alerts/upload", {
        method: "POST",
        headers: {
          "Content-Length": "512",
          Origin: "https://streambrew.test",
          "X-StreamBrew-Upload": "1",
        },
        body: form,
      });
    };

    const first = handleAlertUpload(createRequest());
    await vi.waitFor(() => expect(uploadAsset).toHaveBeenCalledOnce());
    const second = await handleAlertUpload(createRequest());

    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toBe("2");
    expect(uploadAsset).toHaveBeenCalledOnce();

    finishUpload();
    await expect(first).resolves.toMatchObject({ status: 200 });
  });

  it("authorizes dashboard and overlay media with different principals", async () => {
    const assetId = "64fb569a-95bb-4d1a-a6ad-765b0f2d5702";
    getUserId.mockResolvedValue(42);
    asset.mockResolvedValue(new Response("media", { headers: { "Content-Type": "image/png" } }));

    const dashboardResponse = await handleAlertMedia(
      new Request(`https://streambrew.test/api/alerts/media/${assetId}`),
    );
    const overlayResponse = await handleAlertMedia(
      new Request(`https://streambrew.test/api/alerts/media/${assetId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "t".repeat(32) }),
      }),
    );

    expect(dashboardResponse.status).toBe(200);
    expect(overlayResponse.status).toBe(200);
    expect(asset).toHaveBeenNthCalledWith(1, assetId, { userId: 42 }, undefined, expect.anything());
    expect(asset).toHaveBeenNthCalledWith(
      2,
      assetId,
      { token: "t".repeat(32) },
      undefined,
      expect.anything(),
    );
  });

  it("rejects declared and streamed media bodies over the small JSON limit", async () => {
    const assetId = "64fb569a-95bb-4d1a-a6ad-765b0f2d5702";
    const declared = await handleAlertMedia(
      new Request(`https://streambrew.test/api/alerts/media/${assetId}`, {
        method: "POST",
        headers: { "Content-Length": "257" },
        body: "{}",
      }),
    );
    const streamed = await handleAlertMedia(
      new Request(`https://streambrew.test/api/alerts/media/${assetId}`, {
        method: "POST",
        headers: { "Content-Length": "1" },
        body: JSON.stringify({ token: "t".repeat(32), padding: "x".repeat(300) }),
      }),
    );

    expect(declared.status).toBe(413);
    expect(streamed.status).toBe(413);
    expect(asset).not.toHaveBeenCalled();
  });

  it("relays validated keepalives through the POST stream", async () => {
    streamOverlay.mockImplementation(async function* () {
      yield { type: "keepalive" };
    });
    const token = "t".repeat(32);

    const response = await handleAlertStream(
      new Request("https://streambrew.test/api/alerts/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          playerId: "6a9cabbb-d675-40f5-a248-c40558f75d58",
          generation: 2,
        }),
      }),
    );

    await expect(response.text()).resolves.toBe('{"type":"keepalive"}\n');
    expect(streamOverlay).toHaveBeenCalledWith(
      token,
      "6a9cabbb-d675-40f5-a248-c40558f75d58",
      2,
      expect.any(AbortSignal),
    );
  });

  it("allows chunked stream requests but rejects declared and streamed overflow", async () => {
    streamOverlay.mockImplementation(async function* () {
      yield { type: "keepalive" };
    });
    const identity = {
      token: "t".repeat(32),
      playerId: "6a9cabbb-d675-40f5-a248-c40558f75d58",
      generation: 2,
    };
    const chunked = await handleAlertStream(
      new Request("https://streambrew.test/api/alerts/stream", {
        method: "POST",
        body: JSON.stringify(identity),
      }),
    );
    const declared = await handleAlertStream(
      new Request("https://streambrew.test/api/alerts/stream", {
        method: "POST",
        headers: { "Content-Length": "513" },
        body: "{}",
      }),
    );
    const streamed = await handleAlertStream(
      new Request("https://streambrew.test/api/alerts/stream", {
        method: "POST",
        headers: { "Content-Length": "1" },
        body: JSON.stringify({ ...identity, padding: "x".repeat(512) }),
      }),
    );

    await expect(chunked.text()).resolves.toBe('{"type":"keepalive"}\n');
    expect(declared.status).toBe(413);
    expect(streamed.status).toBe(413);
    expect(streamOverlay).toHaveBeenCalledTimes(1);
  });

  it("serializes donation IDs safely for the browser NDJSON stream", async () => {
    streamOverlay.mockImplementation(async function* () {
      yield {
        type: "playback",
        playback: {
          playbackId: "64fb569a-95bb-4d1a-a6ad-765b0f2d5702",
          donationId: 12n,
          kind: "incoming",
          state: "pending",
          source: "donationalerts",
          author: "Viewer",
          message: null,
          amount: "10.00",
          currency: "USD",
          imageAssetId: null,
          soundAssetId: null,
          ttsAssetId: null,
          displayDurationMs: 5_000,
          soundVolume: 70,
          ttsVolume: 80,
          accentColor: "#ffbd3e",
          createdAt: new Date("2026-09-13T10:00:00Z"),
          startedAt: null,
          finishedAt: null,
          detail: null,
        },
      };
    });

    const response = await handleAlertStream(
      new Request("https://streambrew.test/api/alerts/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: "t".repeat(32),
          playerId: "6a9cabbb-d675-40f5-a248-c40558f75d58",
          generation: 2,
        }),
      }),
    );
    const event = JSON.parse(await response.text()) as { playback: { donationId: unknown } };

    expect(event.playback.donationId).toBe("12");
  });

  it.each([400, 404, 409, 413, 415, 422])(
    "preserves an upstream upload status of %s",
    async (status) => {
      getUserId.mockResolvedValue(42);
      uploadAsset.mockRejectedValue(new DonationAlertServiceError("http error", { status }));
      const form = new FormData();
      form.set("kind", "image");
      form.set("file", new File(["png"], "alert.png", { type: "image/png" }));

      const response = await handleAlertUpload(
        new Request("https://streambrew.test/api/alerts/upload", {
          method: "POST",
          headers: {
            "Content-Length": "512",
            Origin: "https://streambrew.test",
            "X-StreamBrew-Upload": "1",
          },
          body: form,
        }),
      );

      expect(response.status).toBe(status);
    },
  );

  it("maps an unavailable upstream upload service to 503", async () => {
    getUserId.mockResolvedValue(42);
    uploadAsset.mockRejectedValue(new DonationAlertServiceError("http error", { status: 502 }));
    const form = new FormData();
    form.set("kind", "image");
    form.set("file", new File(["png"], "alert.png", { type: "image/png" }));

    const response = await handleAlertUpload(
      new Request("https://streambrew.test/api/alerts/upload", {
        method: "POST",
        headers: {
          "Content-Length": "512",
          Origin: "https://streambrew.test",
          "X-StreamBrew-Upload": "1",
        },
        body: form,
      }),
    );

    expect(response.status).toBe(503);
  });
});
