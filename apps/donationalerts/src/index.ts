import { getDonations } from "@coldbrew/packages/donationalerts.js";
import { logger } from "@coldbrew/packages/logger.js";
import { DonationAlertsUser, UserId } from "@coldbrew/packages/schemas.js";
import { CronJob } from "cron";

import { store } from "./sensors/db/index.js";
import { refreshListeners, type RunningDonationListener } from "./service/listeners.js";

async function syncUserDonations(user: DonationAlertsUser) {
  const $donations = await getDonations(user.accessToken);
  return $donations.match(
    (value) => store.insertDonations(user.userId, value),
    (error) => logger.error(error),
  );
}

async function syncHistory() {
  const users = await store.getUsersAuthenticatedInDonationAlerts();
  for (const user of users) {
    await syncUserDonations(user);
  }
}

async function main() {
  const inWork = new Map<UserId, RunningDonationListener>();

  await refreshListeners(inWork);

  CronJob.from({
    start: true,
    onTick: () => void refreshListeners(inWork),
    cronTime: "*/10 * * * * *",
  });

  CronJob.from({
    start: true,
    onTick: () => void syncHistory(),
    cronTime: "0 0 * * *",
  });
}

main();
