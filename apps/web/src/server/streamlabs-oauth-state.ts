import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { parseCookie, serializeCookie } from "cookie-es";

import { env } from "./env.js";

const cookieName = "coldbrew-streamlabs-oauth";
const stateLifetimeSeconds = 10 * 60;

function signature(state: string, userId: number) {
  return createHmac("sha256", env.BETTER_AUTH_SECRET)
    .update(`${state}:${userId}`)
    .digest("base64url");
}

function cookieOptions() {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "lax" as const,
    secure: new URL(env.APP_DOMAIN).protocol === "https:",
  };
}

export function createStreamlabsOAuthAttempt(userId: number) {
  const state = randomBytes(32).toString("base64url");
  return {
    state,
    cookie: serializeCookie(cookieName, `${state}.${signature(state, userId)}`, {
      ...cookieOptions(),
      maxAge: stateLifetimeSeconds,
    }),
  };
}

export function clearStreamlabsOAuthAttempt() {
  return serializeCookie(cookieName, "", {
    ...cookieOptions(),
    expires: new Date(0),
    maxAge: 0,
  });
}

export function verifyStreamlabsOAuthAttempt(request: Request, state: string, userId: number) {
  const cookie = parseCookie(request.headers.get("cookie") ?? "")[cookieName];
  if (cookie === undefined) {
    return false;
  }
  const expected = `${state}.${signature(state, userId)}`;
  const actualBytes = Buffer.from(cookie);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}
