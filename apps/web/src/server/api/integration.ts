import { getDonations, issueConnection } from "@coldbrew/packages/donationalerts.js";
import { logger } from "@coldbrew/packages/logger.js";
import { rurl } from "@lebedevna/readonly-url";
import { ok, safeTry } from "neverthrow";

import { env } from "../env.js";
import { getRedirectUri } from "../lib/getRedirectUrl.js";
import { store } from "../sensors/db/index.js";
import { donationAlertsConfig } from "../sensors/donationalerts.js";
import { getUserId } from "./_util.js";

export async function handleDonationAlertsCallback(request: Request): Promise<Response> {
  const authCode = rurl(request.url).searchParams.get("code");
  if (!authCode) return new Response("no auth code", { status: 400 });

  const userId = await getUserId(request);
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const appUrl = rurl("/integrations", env.APP_DOMAIN);

  return await safeTry(async function* () {
    const connection = yield* issueConnection(donationAlertsConfig, authCode, getRedirectUri());
    const donations = yield* getDonations(connection.accessToken);
    await store.saveDonationAlertsConnection(userId, connection);
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
