import { url } from "@lebedevna/readonly-url";
import { logger } from "@omnistream/packages/logger.js";

import { getRequestOrigin } from "../lib/request-origin.js";
import { store } from "../sensors/db/index.js";
import { donationAlerts } from "../sensors/donationalerts.js";
import { getUserId } from "./_util.js";

export async function handleDonationAlertsCallback(request: Request): Promise<Response> {
  const authCode = url(request.url).searchParams.get("code");
  if (!authCode) return new Response("no auth code", { status: 400 });

  const userId = await getUserId(request);
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const appUrl = url("/integrations", getRequestOrigin(request));

  return await donationAlerts.issueTokens(authCode, url(request.url).withSearch("").href).match(
    async (tokens) => {
      await store.setTokens(userId, tokens.refreshToken, tokens.accessToken);
      const $donations = await donationAlerts.getDonations(tokens.accessToken);
      if ($donations.isOk()) {
        await store.insertDonations(userId, $donations.value);
      } else {
        logger.error($donations.error);
      }
      return Response.redirect(appUrl.withSearchParam("success", true).href, 302);
    },
    async () => {
      return Response.redirect(appUrl.withSearchParam("success", false).href, 302);
    },
  );
}
