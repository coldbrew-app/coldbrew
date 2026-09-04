import { donationIntegration } from "./donation-integration/client.js";
import { env } from "./env.js";

export const donationAlertsCallbackURL = new URL(
  "/api/integration/donationalerts/callback",
  env.APP_DOMAIN,
).href;

export async function donationAlertsAuthorizationURL() {
  const result = await donationIntegration.authorizationUrl(donationAlertsCallbackURL);
  return result.authorizationUrl;
}

export async function authorizeDonationAlerts(userId: number, code: string) {
  await donationIntegration.connect(userId, code, donationAlertsCallbackURL);
}
