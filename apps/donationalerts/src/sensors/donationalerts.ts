import { DonationAlertsFacade } from "@omnistream/packages/donationalerts.js";

import { env } from "../env.js";

export const donationAlerts = new DonationAlertsFacade({
  clientId: env.DONATION_ALERTS_CLIENT_ID,
  clientSecret: env.DONATION_ALERTS_CLIENT_SECRET,
});
