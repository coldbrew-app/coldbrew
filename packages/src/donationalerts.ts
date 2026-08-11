import dayjs from "dayjs";
import { z } from "zod";

import { fetchJson } from "./neverthrow/fetch.js";
import { validate } from "./neverthrow/validate.js";
import {
  AccessToken,
  AccessTokenSchema,
  Donation,
  RefreshToken,
  RefreshTokenSchema,
} from "./schemas.js";

export const DONATION_ALERTS_SCOPES = [
  "oauth-user-show",
  "oauth-donation-subscribe",
  "oauth-donation-index",
  "oauth-custom_alert-store",
  "oauth-goal-subscribe",
  "oauth-poll-subscribe",
].join(" ");

export class DonationAlerts {
  constructor(
    private config: {
      readonly clientId: string;
      readonly clientSecret: string;
    },
  ) {}

  getDonations(accessToken: AccessToken) {
    const ResDonationSchema = z.object({
      id: z.number(),
      name: z.string(),
      username: z.string().nullable(),
      message_type: z.string(),
      message: z.string().nullable(),
      amount: z.number(),
      is_shown: z.number(),
      created_at: z.coerce.date().transform((d) => dayjs(d).add(3, "h").toDate()),
      shown_at: z.string().nullable(),
    });

    const schema = z.object({
      data: z.array(ResDonationSchema),
      meta: z.object({
        last_page: z.number().int().positive(),
        total: z.number().int().nonnegative(),
      }),
    });

    return fetchJson("https://www.donationalerts.com/api/v1/alerts/donations", {
      headers: { "Authorization": `Bearer ${accessToken}` },
    })
      .andThen((data) => validate(schema, data).map((v) => v.data))
      .map((parsed) =>
        parsed.map(
          (donation): Omit<Donation, "donationId"> => ({
            origin: "donationalerts",
            originDonationId: String(donation.id),
            amount: donation.amount,
            author: donation.username,
            message: donation.message,
            createdAt: donation.created_at,
          }),
        ),
      );
  }

  // TODO: remove redirectUri?
  issueTokens(authCode: string, redirectUri: string) {
    const searchParams = new URLSearchParams({
      "grant_type": "authorization_code",
      "client_id": this.config.clientId,
      "client_secret": this.config.clientSecret,
      // not used for anything
      "redirect_uri": redirectUri,
      "code": authCode,
    });

    const schema = z.object({
      "token_type": z.literal("Bearer"),
      "expires_in": z.number(),
      "access_token": AccessTokenSchema,
      "refresh_token": RefreshTokenSchema,
    });

    return fetchJson("https://www.donationalerts.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: searchParams.toString(),
    })
      .andThen((data) => validate(schema, data))
      .map((parsed) => ({
        accessToken: parsed.access_token,
        refreshToken: parsed.refresh_token,
      }));
  }

  refreshTokens(refreshToken: RefreshToken) {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      scope: DONATION_ALERTS_SCOPES,
    });

    const schema = z.object({
      "token_type": z.literal("Bearer"),
      "expires_in": z.number(),
      "access_token": AccessTokenSchema,
      "refresh_token": RefreshTokenSchema,
    });

    return fetchJson("https://www.donationalerts.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    })
      .andThen((data) => validate(schema, data))
      .map((parsed) => ({
        accessToken: parsed.access_token,
        refreshToken: parsed.refresh_token,
      }));
  }
}
