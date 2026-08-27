import { subscribeToDonations } from "@coldbrew/packages/donationalerts.js";
import { logger } from "@coldbrew/packages/logger.js";
import { DonationAlertsUser, UserId } from "@coldbrew/packages/schemas.js";
import { delay } from "@lebedevna/delay";
import { ok, safeTry } from "neverthrow";
import { defer } from "using-defer";

import { store } from "../sensors/db/index.js";
import { refreshAccessToken } from "./refresh-access-token.js";

async function deployListener(user: DonationAlertsUser, signal: AbortSignal) {
  const { userId } = user;
  let { accessToken, refreshToken } = user;

  await safeTry(async function* () {
    outer_loop: while (true) {
      if (signal.aborted) return ok();

      for await (const event of subscribeToDonations(accessToken, signal)) {
        if (signal.aborted) return ok();

        if (event.name == "donation") {
          await store.insertDonations(userId, [event.data]);
        }
        if (event.name == "error" && event.data.type == "donationalerts: unauthorized") {
          const tokens = yield* refreshAccessToken({ userId, accessToken, refreshToken });
          accessToken = tokens.accessToken;
          refreshToken = tokens.refreshToken;
          continue outer_loop;
        }
      }
    }
  }).match(
    () => logger.info(`listener exited gracefully: userId=${userId}`),
    async (error) => {
      if (error.type == "donationalerts: failed to fetch tokens") {
        if (error.cause.type == "donationalerts: unauthorized") {
          await store.disconnectDonationAlerts(userId);
        }
      }
      logger.error(error);
    },
  );
}

let isRunning = false;
export async function refreshListeners(running: Map<UserId, AbortController>) {
  if (isRunning) {
    logger.debug("refreshListeners: skip (is running)");
    return;
  }
  isRunning = true;
  using _ = defer(() => (isRunning = false));

  const start = performance.now();
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
      deployListener(user, userController.signal).finally(() => running.delete(user.userId));
      await delay(50);
    }
  }
  const end = performance.now();
  logger.debug(`refreshListeners: ${Math.round(end - start) / 1000}`);
}
