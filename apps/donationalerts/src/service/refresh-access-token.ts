import { refreshTokens } from "@coldbrew/packages/donationalerts.js";
import { RefreshToken, UserId } from "@coldbrew/packages/schemas.js";
import { erro } from "@lebedevna/neverthrow-utils";
import { ok, safeTry } from "neverthrow";

import { store } from "../sensors/db/index.js";
import { donationAlertsConfig } from "../sensors/donationalerts.js";

export function refreshAccessToken(user: {
  userId: UserId;
  refreshToken: RefreshToken;
  tokenVersion: number;
}) {
  return safeTry(async function* () {
    const tokens = yield* refreshTokens(donationAlertsConfig, user.refreshToken).mapErr((error) =>
      erro.fmt({ type: "donationalerts: failed to fetch tokens", cause: error }),
    );

    const updated = await store.setTokens(
      user.userId,
      user.tokenVersion,
      tokens.refreshToken,
      tokens.accessToken,
    );
    if (!updated) return erro({ type: "donationalerts: stale credentials" });

    return ok({ ...tokens, tokenVersion: user.tokenVersion + 1 });
  });
}
