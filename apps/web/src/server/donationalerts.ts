import { donationIntegration } from "./donation-integration/client.js";
import { env } from "./env.js";

const donationAlertsCallbackURL = new URL(
  "/api/integration/donationalerts/callback",
  env.APP_DOMAIN,
).href;

export async function donationAlertsAuthorizationURL() {
  const result = await donationIntegration.authorizationUrl(
    "donationalerts",
    donationAlertsCallbackURL,
  );
  return result.authorizationUrl;
}

export async function authorizeDonationAlerts(userId: number, code: string) {
  await donationIntegration.connect("donationalerts", userId, code, donationAlertsCallbackURL);
}

export const donationAlertsAuthorizationStartURL = new URL(
  "/api/integration/donationalerts/authorize",
  env.APP_DOMAIN,
).href;
