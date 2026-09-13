import {
  AlertAssetSchema,
  AlertDashboardSchema,
  AlertOverlayEventSchema,
  AlertOverlayOpenSchema,
  AlertOverlayTokenSchema,
  AlertRendererDiagnosticCodeSchema,
  AlertSettingsSchema,
  type AlertAssetKind,
  type AlertOverlayEvent,
  type AlertRendererDiagnosticCode,
  type AlertSettings,
} from "@coldbrew/packages/alerts.js";
import { parseJson, RequestError, requestJson } from "@coldbrew/packages/http.js";
import { rurl } from "@lebedevna/readonly-url";
import { readNdjsonLines } from "@web/lib/ndjson";
import { z } from "zod";

import { env } from "../env.js";

export class DonationAlertServiceError extends Error {
  // fallow-ignore-next-line unused-class-member -- Stable error discriminator at the adapter seam.
  readonly type = "donation alert service error";
  readonly detail: string;
  readonly status?: number;

  constructor(detail: string, options: ErrorOptions & { status?: number } = {}) {
    super(`Donation alert service ${detail}.`, options);
    this.name = "DonationAlertServiceError";
    this.detail = detail;
    this.status = options.status;
  }
}

const TokenSchema = z.object({
  token: AlertOverlayTokenSchema,
});
const maximumStreamLineLength = 64 * 1024;

function serviceUrl(path: string) {
  return rurl(path, env.DONATIONS_SERVICE_URL);
}

function serviceHeaders() {
  return {
    Authorization: `Bearer ${env.DONATIONS_SERVICE_SECRET}`,
    "Content-Type": "application/json",
  };
}

function toServiceError(cause: unknown) {
  if (cause instanceof RequestError) {
    return new DonationAlertServiceError(cause.type, { cause, status: cause.status });
  }
  if (cause instanceof DonationAlertServiceError) {
    return cause;
  }
  return new DonationAlertServiceError("unexpected error", { cause });
}

async function request<Output>(
  path: string,
  schema: z.ZodType<Output>,
  body: unknown,
  signal?: AbortSignal,
) {
  try {
    return await requestJson(serviceUrl(path).href, schema, {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify(body),
      signal,
    });
  } catch (cause) {
    throw toServiceError(cause);
  }
}

function parseStreamEvent(line: string): AlertOverlayEvent {
  if (line.length > maximumStreamLineLength) {
    throw new DonationAlertServiceError("stream event too large");
  }
  try {
    return parseJson(line, AlertOverlayEventSchema);
  } catch (cause) {
    throw toServiceError(cause);
  }
}

export const donationAlertService = {
  dashboard(userId: number, signal?: AbortSignal) {
    return request("/internal/alerts/dashboard", AlertDashboardSchema, { userId }, signal);
  },

  updateSettings(userId: number, settings: AlertSettings, signal?: AbortSignal) {
    const { paused: _paused, ...editableSettings } = AlertSettingsSchema.parse(settings);
    return request("/internal/alerts/settings", z.null(), { userId, ...editableSettings }, signal);
  },

  rotateToken(userId: number, signal?: AbortSignal) {
    return request("/internal/alerts/token/rotate", TokenSchema, { userId }, signal);
  },

  test(userId: number, signal?: AbortSignal) {
    return request("/internal/alerts/test", z.null(), { userId }, signal);
  },

  setPaused(userId: number, paused: boolean, signal?: AbortSignal) {
    return request("/internal/alerts/paused", z.null(), { userId, paused }, signal);
  },

  skip(userId: number, signal?: AbortSignal) {
    return request("/internal/alerts/skip", z.null(), { userId }, signal);
  },

  replay(userId: number, playbackId: string, signal?: AbortSignal) {
    return request("/internal/alerts/replay", z.null(), { userId, playbackId }, signal);
  },

  openOverlay(token: string, signal?: AbortSignal) {
    return request("/internal/alerts/overlay/open", AlertOverlayOpenSchema, { token }, signal);
  },

  heartbeat(
    token: string,
    playerId: string,
    generation: number,
    active: boolean,
    visible: boolean,
    signal?: AbortSignal,
  ) {
    return request(
      "/internal/alerts/overlay/heartbeat",
      z.null(),
      {
        token,
        playerId,
        generation,
        active,
        visible,
      },
      signal,
    );
  },

  started(
    token: string,
    playerId: string,
    generation: number,
    playbackId: string,
    signal?: AbortSignal,
  ) {
    return request(
      "/internal/alerts/overlay/started",
      z.null(),
      {
        token,
        playerId,
        generation,
        playbackId,
      },
      signal,
    );
  },

  finished(
    token: string,
    playerId: string,
    generation: number,
    playbackId: string,
    outcome: "completed" | "interrupted",
    signal?: AbortSignal,
  ) {
    return request(
      "/internal/alerts/overlay/finished",
      z.null(),
      {
        token,
        playerId,
        generation,
        playbackId,
        outcome,
      },
      signal,
    );
  },

  diagnostic(
    token: string,
    playerId: string,
    generation: number,
    playbackId: string,
    code: AlertRendererDiagnosticCode,
    signal?: AbortSignal,
  ) {
    return request(
      "/internal/alerts/overlay/diagnostic",
      z.null(),
      {
        token,
        playerId,
        generation,
        playbackId,
        code: AlertRendererDiagnosticCodeSchema.parse(code),
      },
      signal,
    );
  },

  uploadAsset(
    userId: number,
    kind: Extract<AlertAssetKind, "image" | "sound">,
    contentType: string,
    contentBase64: string,
    signal?: AbortSignal,
  ) {
    return request(
      "/internal/alerts/asset",
      AlertAssetSchema,
      {
        userId,
        kind,
        contentType,
        contentBase64,
      },
      signal,
    );
  },

  deleteAsset(userId: number, assetId: string, signal?: AbortSignal) {
    return request("/internal/alerts/asset/delete", z.null(), { userId, assetId }, signal);
  },

  async asset(
    assetId: string,
    principal: { userId: number } | { token: string },
    range?: string,
    signal?: AbortSignal,
  ) {
    let response: Response;
    try {
      response = await fetch(serviceUrl("/internal/alerts/asset/read").href, {
        method: "POST",
        headers: {
          ...serviceHeaders(),
          ...(range === undefined ? {} : { Range: range }),
        },
        body: JSON.stringify({ assetId, ...principal }),
        signal,
      });
    } catch (cause) {
      throw new DonationAlertServiceError("fetch error", { cause });
    }
    if (!response.ok) {
      throw new DonationAlertServiceError("http error", { status: response.status });
    }
    return response;
  },

  async *streamOverlay(
    token: string,
    playerId: string,
    generation: number,
    signal: AbortSignal,
  ): AsyncIterable<AlertOverlayEvent> {
    let response: Response;
    try {
      response = await fetch(serviceUrl("/internal/alerts/overlay/stream").href, {
        method: "POST",
        headers: serviceHeaders(),
        body: JSON.stringify({ token, playerId, generation }),
        signal,
      });
    } catch (cause) {
      if (signal.aborted) return;
      throw new DonationAlertServiceError("fetch error", { cause });
    }
    if (!response.ok) {
      throw new DonationAlertServiceError("http error", { status: response.status });
    }
    if (response.body === null) {
      throw new DonationAlertServiceError("missing response body");
    }

    for await (const line of readNdjsonLines(response.body, signal, {
      maximumLineLength: maximumStreamLineLength,
      readError: (cause) => new DonationAlertServiceError("stream read error", { cause }),
      lineTooLongError: () => new DonationAlertServiceError("stream event too large"),
    })) {
      yield parseStreamEvent(line);
    }
  },
};
