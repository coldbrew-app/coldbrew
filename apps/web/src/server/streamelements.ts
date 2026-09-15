import { donationIntegration } from "./donation-integration/client.js";
import { env } from "./env.js";

const streamElementsCallbackURL = new URL(
  "/api/integration/streamelements/callback",
  env.APP_DOMAIN,
).href;

export const streamElementsAuthorizationStartURL = new URL(
  "/api/integration/streamelements/authorize",
  env.APP_DOMAIN,
).href;

export async function streamElementsAuthorizationURL(state: string) {
  const result = await donationIntegration.authorizationUrl(
    "streamelements",
    streamElementsCallbackURL,
    state,
  );
  return result.authorizationUrl;
}

export async function authorizeStreamElements(userId: number, code: string) {
  await donationIntegration.connect("streamelements", userId, code, streamElementsCallbackURL);
}
