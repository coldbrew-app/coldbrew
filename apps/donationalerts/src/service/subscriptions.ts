import {
  DonationAlertsSubscription,
  DonationAlertsUnauthorizedError,
} from "@omnistream/packages/donationalerts.js";
import { isInstanceof } from "@omnistream/packages/isInstanceof.js";
import { logger } from "@omnistream/packages/logger.js";
import { DonationAlertsUser, UserId } from "@omnistream/packages/schemas.js";
import { ok, safeTry } from "neverthrow";

import { store } from "../sensors/db/index.js";
import { donationAlerts } from "../sensors/donationalerts.js";

export const refreshAccessToken = (user: DonationAlertsUser) => {
  return safeTry(async function* () {
    const tokens = yield* donationAlerts.refreshTokens(user.refreshToken);
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

    try {
      const subscription = donationAlerts.subscribeToDonations(user.accessToken, {
        onDonation: (donation) => void store.insertDonations(user.userId, [donation]),
        onError: (error) => void this.handleSubscriptionError(user, subscription, error),
      });
      this.subscriptions.set(user.userId, subscription);
    } catch (error) {
      await this.handleSubscriptionError(user, undefined, error);
    } finally {
      this.pending.delete(user.userId);
    }
  }

  private async handleSubscriptionError(
    user: DonationAlertsUser,
    subscription: DonationAlertsSubscription | undefined,
    error: unknown,
  ) {
    if (!isInstanceof(error, DonationAlertsUnauthorizedError)) {
      logger.error(error);
      return;
    }

    if (this.recovering.has(user.userId)) return;
    this.recovering.add(user.userId);
    subscription?.close();
    if (this.subscriptions.get(user.userId) === subscription) {
      this.subscriptions.delete(user.userId);
    }

    const $tokens = await refreshAccessToken(user);
    await $tokens.match(
      async (tokens) =>
        await this.connect({
          ...user,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        }),
      (refreshError) => logger.error(refreshError),
    );
    this.recovering.delete(user.userId);
  }
}
