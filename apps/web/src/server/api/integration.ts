import { rurl } from "@lebedevna/readonly-url";
import { z } from "zod";

import { authorizeDonationAlerts } from "../donationalerts.js";
import { env } from "../env.js";
import { getUserId } from "./_util.js";

export async function handleDonationAlertsCallback(request: Request): Promise<Response> {
  const authCode = z
    .string()
    .min(1)
    .max(4096)
    .safeParse(rurl(request.url).searchParams.get("code"));
  if (!authCode.success) {
    return new Response("no auth code", { status: 400 });
  }

  const userId = await getUserId(request);
  if (userId === null) {
    return new Response("Unauthorized", { status: 401 });
  }

  const appUrl = rurl("/integrations", env.APP_DOMAIN);

  try {
    await authorizeDonationAlerts(userId, authCode.data);

    return Response.redirect(appUrl.withSearchParam("success", true).href, 302);
  } catch (error) {
    console.error(error);
    return Response.redirect(appUrl.withSearchParam("success", false).href, 302);
  }
}
