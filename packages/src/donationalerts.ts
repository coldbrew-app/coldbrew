import * as alerts from "@kash-88/alerts";
import { delay } from "@lebedevna/delay";
import { erro, parseJson, safeFetch, validate } from "@lebedevna/neverthrow-utils";
import { rurl } from "@lebedevna/readonly-url";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat.js";
import timezone from "dayjs/plugin/timezone.js";
import utc from "dayjs/plugin/utc.js";
import { ok, Result, safeTry } from "neverthrow";
import { z } from "zod";

import { createAbortableStream } from "./create-abortable-stream.js";
import { logger } from "./logger.js";
import { createResultEventStream } from "./result-stream.js";
import {
  AccessToken,
  AccessTokenSchema,
  CurrencyCodeSchema,
  Donation,
  MoneyAmountSchema,
  RefreshToken,
  RefreshTokenSchema,
} from "./schemas.js";

dayjs.extend(customParseFormat);
dayjs.extend(utc);
dayjs.extend(timezone);

export type RawDonation = Omit<Donation, "donationId" | "userId">;

export type DonationAlertsConfig = Readonly<{
  clientId: string;
  clientSecret: string;
}>;

const DONATION_ALERTS_TIME_ZONE = "Europe/Moscow";

const scopes = [
  alerts.OAuthScope.UserShow,
  alerts.OAuthScope.DonationSubscribe,
  alerts.OAuthScope.DonationIndex,
];

const parseDonationDate = Result.fromThrowable(
  (value: string) => dayjs.tz(value, "YYYY-MM-DD HH:mm:ss", DONATION_ALERTS_TIME_ZONE).toDate(),
  (cause) => erro.fmt({ type: "donationalerts: invalid donation date", cause }),
);

const DonationAlertsDateSchema = z
  .string()
  .min(1)
  .transform((value, context) => {
    const $occurredAt = parseDonationDate(value);
    if ($occurredAt.isErr() || Number.isNaN($occurredAt.value.getTime())) {
      context.addIssue({ code: "custom", message: "Invalid DonationAlerts donation date" });
      return z.NEVER;
    }

    return { sourceCreatedAt: value, occurredAt: $occurredAt.value };
  });

const DonationAlertsDonationSchema = z.object({
  id: z.number(),
  username: z.string().nullable(),
  message: z.string().nullable(),
  amount: MoneyAmountSchema,
  currency: CurrencyCodeSchema,
  created_at: DonationAlertsDateSchema,
  amount_in_user_currency: MoneyAmountSchema.optional(),
});

const WsEventSchema = z.union([
  z.object({
    id: z.literal(1),
    type: z.literal("step 1").default("step 1"),
    result: z.object({
      client: z.uuid(),
      version: z.string(),
    }),
  }),
  z.object({
    id: z.literal(2),
    type: z.literal("step 2").default("step 2"),
    result: z.object({
      recoverable: z.boolean(),
      seq: z.number(),
      epoch: z.string(),
      offset: z.number(),
    }),
  }),
  z.object({
    type: z.literal("user client").default("user client"),
    result: z.object({
      type: z.literal(1),
      channel: z.string(),
      data: z.object({
        info: z.object({
          user: z.string(),
          client: z.uuid(),
        }),
      }),
    }),
  }),
  z.object({
    type: z.literal("donation").default("donation"),
    result: z.object({
      channel: z.string(),
      data: z.object({
        data: DonationAlertsDonationSchema,
      }),
    }),
  }),
]);

const TokensSchema = z.object({
  access_token: AccessTokenSchema,
  refresh_token: RefreshTokenSchema,
});

const UserProfileSchema = z.object({
  id: z.union([z.number(), z.string()]),
});

type DonationAlertsWebServer = {
  authorization(): Promise<void>;
  close(): void;
  on(event: "open", listener: () => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "message", listener: (message: unknown) => void): void;
};

type DonationAlertsRequestError = {
  type: "donationalerts: request error";
  message: string;
  cause: unknown;
};

type DonationAlertsUnauthorizedError = {
  type: "donationalerts: unauthorized";
  message: string;
  cause: unknown;
};

const toSdkRequestError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  return /status code 401|unauthorized/i.test(message)
    ? erro.fmt<DonationAlertsUnauthorizedError>({
        type: "donationalerts: unauthorized",
        cause: error,
        message,
      })
    : erro.fmt<DonationAlertsRequestError>({
        type: "donationalerts: request error",
        message,
        cause: error,
      });
};

const toHttpRequestError = (error: unknown) => {
  const httpError =
    typeof error === "object" && error !== null && "type" in error && "status" in error
      ? error
      : null;
  const message = error instanceof Error ? error.message : String(error);
  return httpError?.type === "http error" && httpError.status === 401
    ? erro.fmt<DonationAlertsUnauthorizedError>({
        type: "donationalerts: unauthorized",
        cause: error,
        message,
      })
    : erro.fmt<DonationAlertsRequestError>({
        type: "donationalerts: request error",
        cause: error,
        message,
      });
};

async function* toEvents<T>(
  client: DonationAlertsWebServer,
  toData: (
    message: unknown,
  ) => Result<T | undefined, DonationAlertsRequestError | DonationAlertsUnauthorizedError>,
  signal: AbortSignal,
) {
  yield* createResultEventStream<T, DonationAlertsRequestError | DonationAlertsUnauthorizedError>(
    (sink) => {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        const $closed = Result.fromThrowable(
          () => client.close(),
          (cause) => toSdkRequestError(cause),
        )();
        if ($closed.isErr()) logger.error($closed.error);
      };
      client.on("open", () => {
        void client.authorization().catch(async (error) => {
          close();
          await sink.fail(toSdkRequestError(error));
        });
      });
      client.on("error", (error) => {
        close();
        void sink.fail(toSdkRequestError(error));
      });
      client.on("message", (message) => {
        const $data = toData(message);
        if ($data.isErr()) {
          close();
          void sink.fail($data.error);
          return;
        }
        if ($data.value !== undefined) void sink.emit($data.value);
      });
      return close;
    },
    signal,
  );
}

export function getAuthorizationUrl(clientId: string, redirectUri: string) {
  return alerts.getAuthorizeLink(clientId, redirectUri, scopes, "code");
}

export function issueConnection(
  config: DonationAlertsConfig,
  authCode: string,
  redirectUri: string,
) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: redirectUri,
    code: authCode,
  });
  return safeFetch("https://www.donationalerts.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  })
    .andThen(parseJson)
    .andThen((tokens) => validate(tokens, TokensSchema))
    .mapErr(toHttpRequestError)
    .andThen(({ access_token, refresh_token }) =>
      safeFetch("https://www.donationalerts.com/api/v1/user/oauth", {
        headers: { Authorization: `Bearer ${access_token}` },
      })
        .andThen(parseJson)
        .andThen((profile) => {
          const schema = z.object({
            data: UserProfileSchema,
          });
          return validate(profile, schema);
        })
        .mapErr(toHttpRequestError)
        .map(({ data: profile }) => ({
          accessToken: access_token,
          refreshToken: refresh_token,
          sourceUserId: String(profile.id),
        })),
    );
}

export function refreshTokens(config: DonationAlertsConfig, refreshToken: RefreshToken) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    scope: [...new Set(scopes)].join(" "),
  });
  return safeFetch("https://www.donationalerts.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  })
    .andThen(parseJson)
    .andThen((tokens) => validate(tokens, TokensSchema))
    .mapErr(toHttpRequestError)
    .map(({ access_token, refresh_token }) => ({
      accessToken: access_token,
      refreshToken: refresh_token,
    }));
}

function getDonationsPage(accessToken: AccessToken, page: number) {
  const schema = z.object({
    data: z.array(DonationAlertsDonationSchema),
    meta: z.object({
      last_page: z.int().positive(),
    }),
  });

  const url = rurl("https://www.donationalerts.com/api/v1/alerts/donations").withSearchParam(
    "page",
    page,
  );
  return safeFetch(url.href, { headers: { Authorization: `Bearer ${accessToken}` } })
    .andThen(parseJson)
    .andThen((data) => validate(data, schema))
    .mapErr(toHttpRequestError);
}

function toDonation(donation: z.infer<typeof DonationAlertsDonationSchema>): RawDonation {
  return {
    source: "donationalerts",
    sourceDonationId: String(donation.id),
    author: donation.username,
    message: donation.message,
    amount: donation.amount,
    currency: donation.currency,
    sourceCreatedAt: donation.created_at.sourceCreatedAt,
    occurredAt: donation.created_at.occurredAt,
  };
}

export function getDonations(accessToken: AccessToken) {
  return safeTry(async function* () {
    const donations: RawDonation[] = [];
    for (let pageNum = 1; ; pageNum++) {
      if (pageNum > 1) {
        await delay(250);
      }
      const page = yield* getDonationsPage(accessToken, pageNum);
      donations.push(...page.data.map(toDonation));

      if (pageNum >= page.meta.last_page) return ok(donations);
    }
  }).mapErr((error) => {
    switch (error.type) {
      case "donationalerts: unauthorized":
        return error;
      default:
        return toHttpRequestError(error);
    }
  });
}

export function subscribeToDonations(accessToken: AccessToken, parentSignal?: AbortSignal) {
  return createAbortableStream(async function* (signal) {
    if (signal.aborted) return;

    // The SDK's declaration omits EventEmitter methods even though WebServer exposes them at runtime.
    const client: DonationAlertsWebServer = new alerts.WebServer({
      access_token: accessToken,
      autoReconnect: true,
    }) as any;

    const toWsEvent = (message: unknown) =>
      validate(message, WsEventSchema).mapErr((cause) =>
        erro.fmt<DonationAlertsRequestError>({
          type: "donationalerts: request error",
          message: "Invalid DonationAlerts WebSocket message",
          cause,
        }),
      );

    for await (const $event of toEvents(client, toWsEvent, signal)) {
      if ($event.isErr()) {
        yield { name: "error" as const, data: $event.error };
        return;
      }
      const message = $event.value;
      if (message.type == "donation") {
        yield {
          name: "donation" as const,
          data: toDonation(message.result.data.data),
        };
      }
    }
  }, parentSignal);
}
