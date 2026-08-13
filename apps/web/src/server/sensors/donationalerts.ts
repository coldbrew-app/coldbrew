import { DonationAlerts } from "@omnistream/packages/donationalerts.js";

import { env } from "../env.js";

export const donationAlerts = new DonationAlerts({
  clientId: env.DONATION_ALERTS_CLIENT_ID,
  clientSecret: env.DONATION_ALERTS_CLIENT_SECRET,
});
