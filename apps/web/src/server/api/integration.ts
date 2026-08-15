import { rurl } from "@lebedevna/readonly-url";
import { logger } from "@omnistream/packages/logger.js";
import { ok, safeTry } from "neverthrow";

import { getRequestOrigin } from "../lib/request-origin.js";
import { store } from "../sensors/db/index.js";
import { donationAlerts } from "../sensors/donationalerts.js";
import { getUserId } from "./_util.js";

export async function handleDonationAlertsCallback(request: Request): Promise<Response> {
  const authCode = rurl(request.url).searchParams.get("code");
  if (!authCode) return new Response("no auth code", { status: 400 });

  const userId = await getUserId(request);
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const appUrl = rurl("/integrations", getRequestOrigin(request));

  return await safeTry(async function* () {
    const tokens = yield* donationAlerts.issueTokens(
      authCode,
      rurl(request.url).withSearch("").href,
    );
    const donations = yield* donationAlerts.getDonations(tokens.accessToken);
    await store.setTokens(userId, tokens.refreshToken, tokens.accessToken);
    await store.insertDonations(userId, donations);

    return ok();
  }).match(
    () => Response.redirect(appUrl.withSearchParam("success", true).href, 302),
    (error) => {
      logger.error(error);
      return Response.redirect(appUrl.withSearchParam("success", false).href, 302);
    },
  );
}
