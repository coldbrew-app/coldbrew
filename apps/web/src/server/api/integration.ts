import { readonlyUrl } from "@lebedevna/readonly-url";
import { env } from "../env.js";
import { store } from "../sensors/db/index.js";
import { donationAlerts } from "../sensors/donationalerts.js";
import { getUserId } from "./_util.js";

export async function handleDonationAlertsCallback(request: Request): Promise<Response> {
  const authCode = new URL(request.url).searchParams.get("code");
  if (!authCode) return new Response("no auth code", { status: 400 });

  const userId = await getUserId(request);
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const appUrl = readonlyUrl(new URL("/integrations", env.AUTH_BASE_URL).href);

  return await donationAlerts
    .issueTokens(authCode, readonlyUrl(request.url).withSearch("").href)
    .match(
      async (tokens) => {
        await store.setTokens(userId, tokens.refreshToken, tokens.accessToken);
        return Response.redirect(appUrl.withSearchParam("success", true).href, 302);
      },
      async () => {
        return Response.redirect(appUrl.withSearchParam("success", false).href, 302);
      },
    );
}
