import * as alerts from "@kash-88/alerts";
import { erro, validate } from "@lebedevna/neverthrow-utils";
import dayjs from "dayjs";
import Emittery from "emittery";
import { ok, ResultAsync, safeTry } from "neverthrow";
import { z } from "zod";

import { delay } from "./delay.js";
import { logger } from "./logger.js";
import {
  AccessToken,
  AccessTokenSchema,
  Donation,
  RefreshToken,
  RefreshTokenSchema,
} from "./schemas.js";

export type RawDonation = Omit<Donation, "donationId" | "userId">;

const scopes = [
  alerts.OAuthScope.UserShow,
  alerts.OAuthScope.DonationSubscribe,
  alerts.OAuthScope.DonationIndex,
  alerts.OAuthScope.CustomAlertStore,
  alerts.OAuthScope.GoalSubscribe,
  alerts.OAuthScope.PollSubscribe,
];

const DonationAlertsDonationSchema = z.object({
  id: z.number(),
  username: z.string().nullable(),
  message: z.string().nullable(),
  amount: z.number(),
  currency: z.string(),
  created_at: z.coerce.date().transform((date) => dayjs(date).add(3, "h").toDate()),
  amount_in_user_currency: z.number(),
});

const DonationsPageSchema = z.object({
  data: z.array(DonationAlertsDonationSchema),
  meta: z.object({ last_page: z.number().int().positive() }),
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

export type DonationAlertsSubscription = {
  close(): void;
};

type DonationAlertsWebServer = {
  authorization(): Promise<void>;
  close(): void;
  on(event: "open", listener: () => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "message", listener: (message: unknown) => void): void;
};

const toDonation = (donation: z.infer<typeof DonationAlertsDonationSchema>): RawDonation => ({
  origin: "donationalerts",
  originDonationId: String(donation.id),
  amount: donation.amount,
  author: donation.username,
  message: donation.message,
  createdAt: donation.created_at,
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

const toRequestError = (error: unknown) => {
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

export class DonationAlertsFacade {
  constructor(
    private readonly config: {
      readonly clientId: string;
      readonly clientSecret: string;
    },
  ) {}

  getAuthorizationUrl(redirectUri: string) {
    return alerts.getAuthorizeLink(this.config.clientId, redirectUri, scopes, "code");
  }

  issueTokens(authCode: string, redirectUri: string) {
    return ResultAsync.fromPromise(
      alerts.getOauthToken(this.config.clientId, this.config.clientSecret, redirectUri, authCode),
      toRequestError,
    )
      .andThen((tokens) => validate(TokensSchema, tokens))
      .map(({ access_token, refresh_token }) => ({
        accessToken: access_token,
        refreshToken: refresh_token,
      }));
  }

  refreshTokens(refreshToken: RefreshToken) {
    return ResultAsync.fromPromise(
      alerts.updateOauthToken(this.config.clientId, this.config.clientSecret, refreshToken, scopes),
      toRequestError,
    )
      .andThen((tokens) => validate(TokensSchema, tokens))
      .map(({ access_token, refresh_token }) => ({
        accessToken: access_token,
        refreshToken: refresh_token,
      }));
  }

  private getDonationsPage(accessToken: AccessToken, page: number) {
    return ResultAsync.fromPromise(
      alerts.getDonationsAlerts(accessToken, page),
      toRequestError,
    ).andThen((data) => validate(DonationsPageSchema, data));
  }

  getDonations(accessToken: AccessToken) {
    const self = this;

    return safeTry(async function* () {
      const donations: RawDonation[] = [];
      for (let pageNum = 1; ; pageNum++) {
        if (pageNum > 1) {
          await delay(250);
        }
        const page = yield* self.getDonationsPage(accessToken, pageNum);
        donations.push(...page.data.map(toDonation));

        if (pageNum >= page.meta.last_page) return ok(donations);
      }
    }).mapErr((err) => {
      switch (err.type) {
        case "donationalerts: unauthorized":
          return err;
        default:
          return erro.fmt({ type: "donationalerts: request error", cause: err });
      }
    });
  }

  subscribeToDonations2(accessToken: AccessToken, signal: AbortSignal) {
    // The SDK's declaration omits EventEmitter methods even though WebServer exposes them at runtime.
    const client: DonationAlertsWebServer = new alerts.WebServer({
      access_token: accessToken,
      autoReconnect: true,
    }) as any;

    signal.addEventListener("abort", () => void client.close());

    const emt = new Emittery<{
      "donation": RawDonation;
      "error": DonationAlertsRequestError | DonationAlertsUnauthorizedError;
    }>();

    client.on("open", () => {
      void client
        .authorization()
        .catch((error: unknown) => emt.emit("error", toRequestError(error)));
    });
    client.on("error", (error) => {
      client.close();
      emt.emit("error", toRequestError(error));
    });
    client.on("message", (message: unknown) => {
      validate(WsEventSchema, message).match(
        (event) => {
          if (event.type == "donation") {
            emt.emit("donation", toDonation(event.result.data.data));
          }
        },
        (error) => logger.error(error),
      );
    });

    return emt.events(["donation", "error"]);
  }

  subscribeToDonations(
    accessToken: AccessToken,
    options: {
      readonly onDonation: (donation: RawDonation) => void;
      readonly onError: (
        error: DonationAlertsRequestError | DonationAlertsUnauthorizedError,
      ) => void;
    },
  ): DonationAlertsSubscription {
    // The SDK's declaration omits EventEmitter methods even though WebServer exposes them at runtime.
    const client: DonationAlertsWebServer = new alerts.WebServer({
      access_token: accessToken,
      autoReconnect: true,
    }) as any;

    client.on("open", () => {
      void client.authorization().catch((error: unknown) => options.onError(toRequestError(error)));
    });
    client.on("error", (error) => options.onError(toRequestError(error)));
    client.on("message", (message: unknown) => {
      validate(WsEventSchema, message).match(
        (event) => {
          if (event.type == "donation") {
            options.onDonation(toDonation(event.result.data.data));
          }
        },
        (error) => logger.error(error),
      );
    });

    return { close: () => client.close() };
  }
}
