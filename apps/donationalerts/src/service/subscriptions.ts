import { DonationAlertsSubscription } from "@coldbrew/packages/donationalerts.js";
import { erro } from "@coldbrew/packages/erro.js";
import { logger } from "@coldbrew/packages/logger.js";
import { DonationAlertsUser, UserId } from "@coldbrew/packages/schemas.js";
import { ok, safeTry } from "neverthrow";

import { store } from "../sensors/db/index.js";
import { donationAlerts } from "../sensors/donationalerts.js";

export const refreshAccessToken = (user: DonationAlertsUser) => {
  return safeTry(async function* () {
    const tokens = yield* donationAlerts
      .refreshTokens(user.refreshToken)
      .mapErr((err) => erro.fmt({ type: "donationalerts: failed to fetch tokens", cause: err }));

    await store.setTokens(user.userId, tokens.refreshToken, tokens.accessToken);
    return ok(tokens);
  });
};

export class Subscriptions {
  private readonly subscriptions = new Map<UserId, DonationAlertsSubscription>();
  private readonly pending = new Set<UserId>();
  private readonly recovering = new Set<UserId>();

  async refresh() {
    const users = await store.getUsersAuthenticatedInDonationAlerts();
    const activeUserIds = new Set(users.map((user) => user.userId));

    for (const [userId, subscription] of this.subscriptions) {
      if (!activeUserIds.has(userId)) {
        subscription.close();
        this.subscriptions.delete(userId);
      }
    }

    for (const user of users) {
      if (!this.subscriptions.has(user.userId) && !this.pending.has(user.userId)) {
        void this.connect(user);
      }
    }
  }

  private async connect(user: DonationAlertsUser) {
    this.pending.add(user.userId);

    const subscription = donationAlerts.subscribeToDonations(user.accessToken, {
      onDonation: (donation) => void store.insertDonations(user.userId, [donation]),
      onError: async (error) => {
        if (error.type == "donationalerts: unauthorized") return;

        subscription.close();
        if (this.subscriptions.get(user.userId) === subscription) {
          this.subscriptions.delete(user.userId);
        }

        await refreshAccessToken(user).match(
          ({ accessToken, refreshToken }) => this.connect({ ...user, accessToken, refreshToken }),
          (error) => logger.error(error),
        );

        this.recovering.delete(user.userId);
      },
    });
    this.subscriptions.set(user.userId, subscription);
    this.pending.delete(user.userId);
  }
}
