import { logError } from "@coldbrew/packages/server-logger.js";
import { rurl } from "@lebedevna/readonly-url";
import { z } from "zod";

import { authorizeDonationAlerts, donationAlertsAuthorizationURL } from "../donationalerts.js";
import { env } from "../env.js";
import {
  clearStreamlabsOAuthAttempt,
  createStreamlabsOAuthAttempt,
  verifyStreamlabsOAuthAttempt,
} from "../streamlabs-oauth-state.js";
import { authorizeStreamlabs, streamlabsAuthorizationURL } from "../streamlabs.js";
import { getUserId } from "./_util.js";

const AuthCodeSchema = z.string().min(1).max(4096);
const StreamlabsStateSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

function integrationResultURL(source: "donationalerts" | "streamlabs", success: boolean) {
  return rurl("/integrations", env.APP_DOMAIN)
    .withSearchParam("source", source)
    .withSearchParam("success", success).href;
}

function redirect(location: string, cookie?: string) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    Location: location,
  });
  if (cookie !== undefined) {
    headers.set("Set-Cookie", cookie);
  }
  return new Response(null, { headers, status: 302 });
}

export async function handleDonationAlertsAuthorize(request: Request): Promise<Response> {
  const userId = await getUserId(request);
  if (userId === null) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    return redirect(await donationAlertsAuthorizationURL());
  } catch (error) {
    logError("DonationAlerts authorization failed", error, { userId });
    return new Response("DonationAlerts authorization is unavailable", { status: 503 });
  }
}

export async function handleDonationAlertsCallback(request: Request): Promise<Response> {
  const authCode = AuthCodeSchema.safeParse(rurl(request.url).searchParams.get("code"));
  if (!authCode.success) {
    return new Response("no auth code", { status: 400 });
  }

  const userId = await getUserId(request);
  if (userId === null) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    await authorizeDonationAlerts(userId, authCode.data);

    return redirect(integrationResultURL("donationalerts", true));
  } catch (error) {
    logError("DonationAlerts callback failed", error, { userId });
    return redirect(integrationResultURL("donationalerts", false));
  }
}

export async function handleStreamlabsAuthorize(request: Request): Promise<Response> {
  const userId = await getUserId(request);
  if (userId === null) {
    return new Response("Unauthorized", { status: 401 });
  }
  const attempt = createStreamlabsOAuthAttempt(userId);
  try {
    return redirect(await streamlabsAuthorizationURL(attempt.state), attempt.cookie);
  } catch (error) {
    logError("Streamlabs authorization failed", error, { userId });
    return new Response("Streamlabs authorization is unavailable", { status: 503 });
  }
}

export async function handleStreamlabsCallback(request: Request): Promise<Response> {
  const url = rurl(request.url);
  const state = StreamlabsStateSchema.safeParse(url.searchParams.get("state"));
  const clearCookie = clearStreamlabsOAuthAttempt();
  const userId = await getUserId(request);
  if (userId === null) {
    return new Response("Unauthorized", {
      headers: { "Set-Cookie": clearCookie },
      status: 401,
    });
  }
  if (!state.success || !verifyStreamlabsOAuthAttempt(request, state.data, userId)) {
    return new Response("invalid OAuth state", {
      headers: { "Set-Cookie": clearCookie },
      status: 400,
    });
  }
  const authCode = AuthCodeSchema.safeParse(url.searchParams.get("code"));
  if (!authCode.success) {
    return redirect(integrationResultURL("streamlabs", false), clearCookie);
  }

  try {
    await authorizeStreamlabs(userId, authCode.data);
    return redirect(integrationResultURL("streamlabs", true), clearCookie);
  } catch (error) {
    logError("Streamlabs callback failed", error, { userId });
    return redirect(integrationResultURL("streamlabs", false), clearCookie);
  }
}
