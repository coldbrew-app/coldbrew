import { delay } from "@coldbrew/packages/delay.js";
import { logger } from "@coldbrew/packages/logger.js";
import { DonationAlertsUser, UserId } from "@coldbrew/packages/schemas.js";
import { ok, safeTry } from "neverthrow";

import { store } from "../sensors/db/index.js";
import { donationAlerts } from "../sensors/donationalerts.js";
import { refreshAccessToken } from "./refresh-access-token.js";

async function deployListener(user: DonationAlertsUser, signal: AbortSignal) {
  const { userId } = user;
  let { accessToken, refreshToken } = user;
  await safeTry(async function* () {
    while (true) {
      if (signal.aborted) return ok();

      inner: for await (const event of donationAlerts.subscribeToDonations(accessToken, signal)) {
        if (signal.aborted) return ok();

        if (event.name == "donation") {
          await store.insertDonations(userId, [event.data]);
        }
        if (event.name == "error" && event.data.type == "donationalerts: unauthorized") {
          const tokens = yield* refreshAccessToken({ userId, accessToken, refreshToken });
          accessToken = tokens.accessToken;
          refreshToken = tokens.refreshToken;
          break inner;
        }
      }
    }
  }).match(
    () => logger.info(`listener exited gracefully: userId=${userId}`),
    (error) => logger.error(error),
  );
}

export async function refreshListeners(running: Map<UserId, AbortController>) {
  const users = await store.getUsersAuthenticatedInDonationAlerts();
  const activeUserIds = new Set(users.map((user) => user.userId));

  for (const [userId, controller] of running) {
    if (!activeUserIds.has(userId)) {
      controller.abort();
      running.delete(userId);
    }
  }

  for (const user of users) {
    if (!running.has(user.userId)) {
      const userController = new AbortController();
      running.set(user.userId, userController);
      deployListener(user, userController.signal);
      await delay(50);
    }
  }
}
