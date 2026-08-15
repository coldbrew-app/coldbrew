import { DonationAlertsUnauthorizedError } from "@omnistream/packages/donationalerts.js";
import { isInstanceof } from "@omnistream/packages/isInstanceof.js";
import { logger } from "@omnistream/packages/logger.js";
import { DonationAlertsUser } from "@omnistream/packages/schemas.js";
import { CronJob } from "cron";
import { safeTry } from "neverthrow";

import { store } from "./sensors/db/index.js";
import { donationAlerts } from "./sensors/donationalerts.js";
import { refreshAccessToken, Subscriptions } from "./service/subscriptions.js";

const syncHistory = async () => {
  const users = await store.getUsersAuthenticatedInDonationAlerts();
  for (const user of users) {
    await syncUserDonations(user);
  }
};

const syncUserDonations = async (user: DonationAlertsUser) => {
  return safeTry(async function* () {
    let accessToken = user.accessToken;
    let $donations = await donationAlerts.getDonations(accessToken);

    if ($donations.isErr() && isInstanceof($donations.error, DonationAlertsUnauthorizedError)) {
      const tokens = yield* refreshAccessToken(user);
      $donations = await donationAlerts.getDonations(tokens.accessToken);
    }

    return $donations;
  }).match(
    (value) => store.insertDonations(user.userId, value),
    (err) => logger.error(err),
  );
};

async function main() {
  const subscriptions = new Subscriptions();
  await subscriptions.refresh();

  CronJob.from({
    start: true,
    onTick: () => void subscriptions.refresh(),
    cronTime: "*/10 * * * *",
  });

  CronJob.from({
    start: true,
    onTick: () => void syncHistory(),
    cronTime: "0 0 * * *",
  });
}

main();
