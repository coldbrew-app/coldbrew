import { DonationAlertsSource } from "@coldbrew/packages/donationalerts.js";
import { logger } from "@coldbrew/packages/logger.js";
import { DonationAlertsUser, UserId } from "@coldbrew/packages/schemas.js";
import { delay } from "@lebedevna/delay";
import { ok, safeTry } from "neverthrow";
import { defer } from "using-defer";

import { store } from "../sensors/db/index.js";
import { refreshAccessToken } from "./refresh-access-token.js";

const UNEXPECTED_COMPLETION_RETRY_MS = 5_000;

export type RunningDonationListener = Readonly<{
  controller: AbortController;
  tokenVersion: number;
}>;

async function deployListener(user: DonationAlertsUser, signal: AbortSignal) {
  const { userId } = user;
  let { accessToken, refreshToken, tokenVersion } = user;

  await safeTry(async function* () {
    outer_loop: while (true) {
      if (signal.aborted) return ok();

      const source = new DonationAlertsSource(accessToken);
      for await (const $donation of source.stream(signal)) {
        if (signal.aborted) return ok();

        if ($donation.isErr() && $donation.error.type == "donationalerts: unauthorized") {
          const tokens = yield* refreshAccessToken({
            userId,
            refreshToken,
            tokenVersion,
          });
          accessToken = tokens.accessToken;
          refreshToken = tokens.refreshToken;
          tokenVersion = tokens.tokenVersion;
          continue outer_loop;
        }
        if ($donation.isErr()) {
          logger.warn($donation.error);
          continue;
        }

        await store.insertDonations(userId, [$donation.value]);
      }

      if (!signal.aborted) await delay(UNEXPECTED_COMPLETION_RETRY_MS, { signal });
    }
  }).match(
    () => logger.info(`listener exited gracefully: userId=${userId}`),
    async (error) => {
      if (error.type == "donationalerts: failed to fetch tokens") {
        if (error.cause.type == "donationalerts: unauthorized") {
          const users = await store.getUsersAuthenticatedInDonationAlerts();
          const current = users.find((candidate) => candidate.userId === userId);
          if (current?.tokenVersion === tokenVersion) {
            await store.disconnectDonationAlerts(userId);
          }
        }
      }
      logger.error(error);
    },
  );
}

export const refreshListeners = (() => {
  let isRunning = false;

  return async (running: Map<UserId, RunningDonationListener>) => {
    if (isRunning) {
      logger.debug("refreshListeners: skip (is running)");
      return;
    }
    isRunning = true;
    using _ = defer(() => (isRunning = false));

    const start = performance.now();
    const users = await store.getUsersAuthenticatedInDonationAlerts();
    const usersById = new Map(users.map((user) => [user.userId, user]));

    for (const [userId, listener] of running) {
      const user = usersById.get(userId);
      if (!user || user.tokenVersion !== listener.tokenVersion) {
        listener.controller.abort();
        running.delete(userId);
      }
    }

    for (const user of users) {
      if (!running.has(user.userId)) {
        const controller = new AbortController();
        const listener: RunningDonationListener = {
          controller,
          tokenVersion: user.tokenVersion,
        };
        running.set(user.userId, listener);
        deployListener(user, controller.signal).finally(() => {
          if (running.get(user.userId) === listener) running.delete(user.userId);
        });
        await delay(50);
      }
    }
    const end = performance.now();
    logger.debug(`refreshListeners: ${Math.round(end - start) / 1000}`);
  };
})();
