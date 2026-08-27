import type { DonationAlertsConfig } from "@coldbrew/packages/donationalerts.js";

import { env } from "../env.js";

export const donationAlertsConfig: DonationAlertsConfig = {
  clientId: env.DONATION_ALERTS_CLIENT_ID,
  clientSecret: env.DONATION_ALERTS_CLIENT_SECRET,
};
