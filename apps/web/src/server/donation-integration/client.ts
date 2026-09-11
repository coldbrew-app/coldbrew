import { RequestError, requestJson } from "@coldbrew/packages/http.js";
import type { DonationSource } from "@coldbrew/packages/schemas.js";
import { rurl } from "@lebedevna/readonly-url";
import { z } from "zod";

import { env } from "../env.js";

export class DonationIntegrationError extends Error {
  // fallow-ignore-next-line unused-class-member -- Kept as a stable error discriminator
  readonly type = "donation integration error";
  readonly detail: string;
  readonly status?: number;

  constructor(detail: string, options: ErrorOptions & { status?: number } = {}) {
    super(`Donation integration ${detail}.`, options);
    this.name = "DonationIntegrationError";
    this.detail = detail;
    this.status = options.status;
  }
}

const ConnectResponseSchema = z.object({ connected: z.literal(true) });
const AuthorizationURLSchema = z.object({ authorizationUrl: z.url() });

function serviceUrl(path: string) {
  return rurl(path, env.DONATIONS_SERVICE_URL);
}

function toServiceError(cause: unknown) {
  if (cause instanceof RequestError) {
    return new DonationIntegrationError(cause.type, { cause, status: cause.status });
  }
  return new DonationIntegrationError("unexpected error", { cause });
}

async function request<Output>(path: string, schema: z.ZodType<Output>, body: unknown) {
  try {
    return await requestJson(serviceUrl(path).href, schema, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.DONATIONS_SERVICE_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    throw toServiceError(cause);
  }
}

export const donationIntegration = {
  authorizationUrl(source: DonationSource, redirectUri: string, state = "") {
    return request("/internal/authorization-url", AuthorizationURLSchema, {
      redirectUri,
      source,
      state,
    });
  },

  connect(source: DonationSource, userId: number, authCode: string, redirectUri: string) {
    return request("/internal/connect", ConnectResponseSchema, {
      authCode,
      redirectUri,
      source,
      userId,
    });
  },

  connectDonateStream(userId: number, widgetUrl: string) {
    return request("/internal/connect", ConnectResponseSchema, {
      authCode: "",
      redirectUri: "",
      source: "donate_stream",
      userId,
      widgetUrl,
    });
  },

  disconnect(source: DonationSource, userId: number) {
    return request("/internal/disconnect", z.null(), { source, userId });
  },
};
