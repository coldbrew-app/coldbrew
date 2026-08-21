import { logger } from "@coldbrew/packages/logger.js";
import { DonationAlertsUser, UserId } from "@coldbrew/packages/schemas.js";
import { CronJob } from "cron";
import { safeTry } from "neverthrow";

import { store } from "./sensors/db/index.js";
import { donationAlerts } from "./sensors/donationalerts.js";
import { refreshListeners } from "./service/listeners.js";
import { refreshAccessToken } from "./service/refresh-access-token.js";

async function syncUserDonations(user: DonationAlertsUser) {
  return safeTry(async function* () {
    let accessToken = user.accessToken;
    let $donations = await donationAlerts.getDonations(accessToken);

    if ($donations.isErr() && $donations.error.type == "donationalerts: unauthorized") {
      const tokens = yield* refreshAccessToken(user);
      $donations = await donationAlerts.getDonations(tokens.accessToken);
    }

    return $donations;
  }).match(
    (value) => store.insertDonations(user.userId, value),
    (err) => logger.error(err),
  );
}

async function syncHistory() {
  const users = await store.getUsersAuthenticatedInDonationAlerts();
  for (const user of users) {
    await syncUserDonations(user);
  }
}

async function main() {
  const inWork = new Map<UserId, AbortController>();

  await refreshListeners(inWork);

  CronJob.from({
    start: true,
    onTick: () => void refreshListeners(inWork),
    cronTime: "*/10 * * * *",
  });

  CronJob.from({
    start: true,
    onTick: () => void syncHistory(),
    cronTime: "0 0 * * *",
  });
}

main();
