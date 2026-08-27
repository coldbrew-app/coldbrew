import { refreshTokens } from "@coldbrew/packages/donationalerts.js";
import { AccessToken, RefreshToken, UserId } from "@coldbrew/packages/schemas.js";
import { erro } from "@lebedevna/neverthrow-utils";
import { ok, safeTry } from "neverthrow";

import { store } from "../sensors/db/index.js";
import { donationAlertsConfig } from "../sensors/donationalerts.js";

export function refreshAccessToken(user: {
  userId: UserId;
  accessToken: AccessToken;
  refreshToken: RefreshToken;
}) {
  return safeTry(async function* () {
    const tokens = yield* refreshTokens(donationAlertsConfig, user.refreshToken).mapErr((error) =>
      erro.fmt({ type: "donationalerts: failed to fetch tokens", cause: error }),
    );

    await store.setTokens(user.userId, tokens.refreshToken, tokens.accessToken);
    return ok(tokens);
  });
}
