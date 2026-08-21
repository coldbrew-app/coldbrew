import { DonationAlertsUser } from "@coldbrew/packages/schemas.js";
import { erro } from "@lebedevna/neverthrow-utils";
import { ok, safeTry } from "neverthrow";

import { store } from "../sensors/db/index.js";
import { donationAlerts } from "../sensors/donationalerts.js";

export function refreshAccessToken(user: DonationAlertsUser) {
  return safeTry(async function* () {
    const tokens = yield* donationAlerts
      .refreshTokens(user.refreshToken)
      .mapErr((err) => erro.fmt({ type: "donationalerts: failed to fetch tokens", cause: err }));

    await store.setTokens(user.userId, tokens.refreshToken, tokens.accessToken);
    return ok(tokens);
  });
}
