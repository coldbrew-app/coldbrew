import * as alerts from "@kash-88/alerts";
import { erro, validate } from "@lebedevna/neverthrow-utils";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat.js";
import timezone from "dayjs/plugin/timezone.js";
import utc from "dayjs/plugin/utc.js";
import Emittery from "emittery";
import { ok, ResultAsync, safeTry } from "neverthrow";
import { z } from "zod";

import { delay } from "./delay.js";
import { logger } from "./logger.js";
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

const scopes = [
  alerts.OAuthScope.UserShow,
  alerts.OAuthScope.DonationSubscribe,
  alerts.OAuthScope.DonationIndex,
];

const DonationAlertsDonationSchema = z.object({
  id: z.number(),
  username: z.string().nullable(),
  message: z.string().nullable(),
  amount: MoneyAmountSchema,
  currency: CurrencyCodeSchema,
  created_at: z.string().min(1),
  amount_in_user_currency: MoneyAmountSchema.optional(),
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
      readonly timeZone: string;
    },
  ) {}

  getAuthorizationUrl(redirectUri: string) {
    return alerts.getAuthorizeLink(this.config.clientId, redirectUri, scopes, "code");
  }

  issueConnection(authCode: string, redirectUri: string) {
    const getUser = ResultAsync.fromThrowable(alerts.getUser, toRequestError);
    const getOauthToken = ResultAsync.fromThrowable(alerts.getOauthToken, toRequestError);

    return getOauthToken(this.config.clientId, this.config.clientSecret, redirectUri, authCode)
      .andThen((tokens) => validate(TokensSchema, tokens))
      .andThen(({ access_token, refresh_token }) =>
        getUser(access_token)
          .andThen((profile) => validate(UserProfileSchema, profile))
          .map((profile) => ({
            accessToken: access_token,
            refreshToken: refresh_token,
            sourceUserId: String(profile.id),
          })),
      );
  }

  refreshTokens(refreshToken: RefreshToken) {
    const updateOauthToken = ResultAsync.fromThrowable(alerts.updateOauthToken, toRequestError);

    return updateOauthToken(this.config.clientId, this.config.clientSecret, refreshToken, scopes)
      .andThen((tokens) => validate(TokensSchema, tokens))
      .map(({ access_token, refresh_token }) => ({
        accessToken: access_token,
        refreshToken: refresh_token,
      }));
  }

  private getDonationsPage(accessToken: AccessToken, page: number) {
    const getDonationsAlerts = ResultAsync.fromThrowable(alerts.getDonationsAlerts, toRequestError);

    return getDonationsAlerts(accessToken, page).andThen((data) =>
      validate(DonationsPageSchema, data),
    );
  }

  private toDonation(donation: z.infer<typeof DonationAlertsDonationSchema>): RawDonation {
    const occurredAt = dayjs.tz(donation.created_at, "YYYY-MM-DD HH:mm:ss", this.config.timeZone);
    if (!occurredAt.isValid()) {
      throw new Error(`Invalid DonationAlerts donation date: ${donation.created_at}`);
    }

    return {
      source: "donationalerts",
      sourceDonationId: String(donation.id),
      author: donation.username,
      message: donation.message,
      money: { amount: donation.amount, currency: donation.currency },
      amountInUserCurrency: donation.amount_in_user_currency ?? null,
      sourceCreatedAt: donation.created_at,
      occurredAt: occurredAt.toDate(),
    };
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
        donations.push(...page.data.map((donation) => self.toDonation(donation)));

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

  async *subscribeToDonations(accessToken: AccessToken, signal: AbortSignal) {
    if (signal.aborted) return;

    // The SDK's declaration omits EventEmitter methods even though WebServer exposes them at runtime.
    const client: DonationAlertsWebServer = new alerts.WebServer({
      access_token: accessToken,
      autoReconnect: true,
    }) as any;

    signal.addEventListener("abort", () => client.close(), { once: true });

    const emitter = new Emittery<{
      "donation": RawDonation;
      "error": DonationAlertsRequestError | DonationAlertsUnauthorizedError;
      "end": undefined;
    }>();

    let ended = false;
    const endWithError = (error: unknown) => {
      if (ended || signal.aborted) return;

      ended = true;
      client.close();
      void emitter.emit("error", toRequestError(error));
      void emitter.emit("end");
    };

    const onMessage = (message: unknown) => {
      validate(WsEventSchema, message).match(
        (event) => {
          event.type === "donation" &&
            emitter.emit("donation", this.toDonation(event.result.data.data));
        },
        (error) => logger.error(error),
      );
    };

    client.on("open", () => client.authorization().catch(endWithError));
    client.on("error", endWithError);
    client.on("message", onMessage);

    for await (const event of emitter.events(["donation", "error", "end"], { signal })) {
      if (event.name === "end") return;
      yield event;
    }
  }
}
