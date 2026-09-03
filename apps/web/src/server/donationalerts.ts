import { requestJson } from "@coldbrew/packages/http.js";
import { rurl } from "@lebedevna/readonly-url";
import { z } from "zod";

import { env } from "./env.js";

const callbackURL = rurl("/api/integration/donationalerts/callback", env.APP_DOMAIN).href;
const scopes = ["oauth-user-show", "oauth-donation-subscribe", "oauth-donation-index"];

const TokensSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
});

const ProfileSchema = z.object({
  data: z.object({
    id: z.union([z.string().min(1), z.int().nonnegative()]).transform(String),
  }),
});

export function donationAlertsAuthorizationURL() {
  return rurl("https://www.donationalerts.com/oauth/authorize").withSearchParams({
    client_id: env.DONATION_ALERTS_CLIENT_ID,
    redirect_uri: callbackURL,
    response_type: "code",
    scope: scopes.join(" "),
  }).href;
}

export async function authorizeDonationAlerts(code: string) {
  const tokens = await requestJson("https://www.donationalerts.com/oauth/token", TokensSchema, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.DONATION_ALERTS_CLIENT_ID,
      client_secret: env.DONATION_ALERTS_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: callbackURL,
    }),
  });
  const profile = await requestJson(
    "https://www.donationalerts.com/api/v1/user/oauth",
    ProfileSchema,
    { headers: { Authorization: `Bearer ${tokens.access_token}` } },
  );

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    sourceUserId: profile.data.id,
  };
}
