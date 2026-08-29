import { delay } from "@lebedevna/delay";
import { erro, parseJson, safeFetch, validate } from "@lebedevna/neverthrow-utils";
import { rurl } from "@lebedevna/readonly-url";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat.js";
import utc from "dayjs/plugin/utc.js";
import { ok, Result, safeTry } from "neverthrow";
import { z } from "zod";

import { createAbortableStream } from "./create-abortable-stream.js";
import { createResultEventStream, type ResultStream } from "./result-stream.js";
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

export type RawDonation = Omit<Donation, "donationId" | "userId">;

export type DonationAlertsConfig = Readonly<{
  clientId: string;
  clientSecret: string;
}>;

const DONATION_ALERTS_WEBSOCKET_URL = "wss://centrifugo.donationalerts.com/connection/websocket";
const DONATION_ALERTS_RECONNECT_DELAY_MS = 5_000;

const scopes = ["oauth-user-show", "oauth-donation-subscribe", "oauth-donation-index"];

const parseDonationDate = Result.fromThrowable(
  (value: string) => dayjs.utc(value, "YYYY-MM-DD HH:mm:ss", true).toDate(),
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

const DonationAlertsSocketProfileSchema = z.object({
  data: z.object({
    id: z.union([z.number(), z.string()]),
    socket_connection_token: z.string().min(1),
  }),
});

const DonationAlertsChannelSubscriptionSchema = z.object({
  channels: z.array(
    z.object({
      channel: z.string(),
      token: z.string().min(1),
    }),
  ),
});

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

type DonationAlertsError = DonationAlertsRequestError | DonationAlertsUnauthorizedError;

const toSocketRequestError = (message: string, cause: unknown) =>
  erro.fmt<DonationAlertsRequestError>({
    type: "donationalerts: request error",
    message,
    cause,
  });

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

export function getAuthorizationUrl(clientId: string, redirectUri: string) {
  return rurl("https://www.donationalerts.com/oauth/authorize")
    .withSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: scopes.join(" "),
    })
    .toString();
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

function getSocketProfile(accessToken: AccessToken, signal: AbortSignal) {
  return safeFetch("https://www.donationalerts.com/api/v1/user/oauth", {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal,
  })
    .andThen(parseJson)
    .andThen((profile) => validate(profile, DonationAlertsSocketProfileSchema))
    .mapErr(toHttpRequestError)
    .map(({ data }) => ({
      userId: String(data.id),
      socketConnectionToken: data.socket_connection_token,
    }));
}

function getChannelToken(
  accessToken: AccessToken,
  channel: string,
  clientId: string,
  signal: AbortSignal,
) {
  return safeFetch("https://www.donationalerts.com/api/v1/centrifuge/subscribe", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ channels: [channel], client: clientId }),
    signal,
  })
    .andThen(parseJson)
    .andThen((subscription) => validate(subscription, DonationAlertsChannelSubscriptionSchema))
    .mapErr(toHttpRequestError)
    .andThen(({ channels }) => {
      const subscription = channels.find((value) => value.channel === channel);
      return subscription
        ? ok(subscription.token)
        : erro<DonationAlertsRequestError>({
            type: "donationalerts: request error",
            message: "DonationAlerts did not return the requested channel token",
            cause: channels,
          });
    });
}

function decodeSocketMessage(data: unknown) {
  if (typeof data !== "string") {
    return erro<DonationAlertsRequestError>({
      type: "donationalerts: request error",
      message: "Invalid DonationAlerts WebSocket message",
      cause: data,
    });
  }

  return parseJson(data)
    .andThen((message) => validate(message, WsEventSchema))
    .mapErr((cause) => toSocketRequestError("Invalid DonationAlerts WebSocket message", cause));
}

function openDonationSocket(
  accessToken: AccessToken,
  userId: string,
  socketConnectionToken: string,
  parentSignal: AbortSignal,
): ResultStream<RawDonation, DonationAlertsError> {
  return createResultEventStream<RawDonation, DonationAlertsError>((sink, signal) => {
    const $socket = Result.fromThrowable(
      () => new WebSocket(DONATION_ALERTS_WEBSOCKET_URL),
      (cause) => toSocketRequestError("Could not open DonationAlerts WebSocket", cause),
    )();
    if ($socket.isErr()) {
      void sink.fail($socket.error);
      return;
    }
    const socket = $socket.value;
    const channel = `$alerts:donation_${userId}`;

    const send = (message: unknown) => {
      const $sent = Result.fromThrowable(
        () => socket.send(JSON.stringify(message)),
        (cause) => toSocketRequestError("Could not send DonationAlerts WebSocket message", cause),
      )();
      if ($sent.isErr()) void sink.fail($sent.error);
    };

    const onOpen = () => {
      send({
        params: { token: socketConnectionToken },
        id: 1,
      });
    };
    const onClose = () => void sink.end();
    const onError = (event: Event) =>
      void sink.fail(toSocketRequestError("DonationAlerts WebSocket failed", event));
    const onMessage = (event: MessageEvent) => {
      void (async () => {
        const $message = decodeSocketMessage(event.data);
        if ($message.isErr()) {
          await sink.fail($message.error);
          return;
        }

        const message = $message.value;
        if (message.type === "step 1") {
          const $channelToken = await getChannelToken(
            accessToken,
            channel,
            message.result.client,
            signal,
          );
          if ($channelToken.isErr()) {
            await sink.fail($channelToken.error);
            return;
          }
          if (signal.aborted) return;
          send({
            id: 2,
            method: 1,
            params: { channel, token: $channelToken.value },
          });
          return;
        }

        if (message.type === "donation") {
          await sink.emit(toDonation(message.result.data.data));
        }
      })();
    };

    socket.addEventListener("open", onOpen);
    socket.addEventListener("close", onClose);
    socket.addEventListener("error", onError);
    socket.addEventListener("message", onMessage);

    return () => {
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("close", onClose);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("message", onMessage);
      const $closed = Result.fromThrowable(
        () => socket.close(),
        (cause) => toSocketRequestError("Could not close DonationAlerts WebSocket", cause),
      )();
      void $closed;
    };
  }, parentSignal);
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

    const $profile = await getSocketProfile(accessToken, signal);
    if ($profile.isErr()) {
      if (!signal.aborted) yield { name: "error" as const, data: $profile.error };
      return;
    }

    while (!signal.aborted) {
      const { userId, socketConnectionToken } = $profile.value;
      for await (const $donation of openDonationSocket(
        accessToken,
        userId,
        socketConnectionToken,
        signal,
      )) {
        if ($donation.isErr()) {
          yield { name: "error" as const, data: $donation.error };
          return;
        }
        yield { name: "donation" as const, data: $donation.value };
      }

      if (!signal.aborted) await delay(DONATION_ALERTS_RECONNECT_DELAY_MS, { signal });
    }
  }, parentSignal);
}
