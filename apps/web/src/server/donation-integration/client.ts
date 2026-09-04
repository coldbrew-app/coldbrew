import { RequestError, requestJson } from "@coldbrew/packages/http.js";
import { rurl } from "@lebedevna/readonly-url";
import { z } from "zod";

import { env } from "../env.js";

export class DonationIntegrationError extends Error {
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
  authorizationUrl(redirectUri: string) {
    return request("/internal/authorization-url", AuthorizationURLSchema, { redirectUri });
  },

  connect(userId: number, authCode: string, redirectUri: string) {
    return request("/internal/connect", ConnectResponseSchema, { authCode, redirectUri, userId });
  },

  disconnect(userId: number) {
    return request("/internal/disconnect", z.null(), { userId });
  },
};
