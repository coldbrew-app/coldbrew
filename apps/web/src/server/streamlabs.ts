import { donationIntegration } from "./donation-integration/client.js";
import { env } from "./env.js";

const streamlabsCallbackURL = new URL("/api/integration/streamlabs/callback", env.APP_DOMAIN).href;

export const streamlabsAuthorizationStartURL = new URL(
  "/api/integration/streamlabs/authorize",
  env.APP_DOMAIN,
).href;

export async function streamlabsAuthorizationURL(state: string) {
  const result = await donationIntegration.authorizationUrl(
    "streamlabs",
    streamlabsCallbackURL,
    state,
  );
  return result.authorizationUrl;
}

export async function authorizeStreamlabs(userId: number, code: string) {
  await donationIntegration.connect("streamlabs", userId, code, streamlabsCallbackURL);
}
