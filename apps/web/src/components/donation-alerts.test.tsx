import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { I18nMessages } from "../lib/i18n";

vi.mock("../lib/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/i18n")>();
  return {
    ...actual,
    useI18n: (messages: I18nMessages) => ({
      locale: "ru",
      t: actual.createTranslator("ru", messages),
    }),
  };
});

import {
  DONATION_ALERTS_DONATIONS_URL,
  DonationAlertsMark,
  DonationAlertsNameLink,
} from "./donation-alerts";

describe("DonationAlerts source links", () => {
  it("opens every source representation on the donation list in a separate tab", () => {
    const html = renderToStaticMarkup(
      <>
        <DonationAlertsMark />
        <DonationAlertsNameLink />
      </>,
    );

    expect(DONATION_ALERTS_DONATIONS_URL).toBe(
      "https://www.donationalerts.com/dashboard/activity-feed/donations",
    );
    expect(html.match(new RegExp(`href="${DONATION_ALERTS_DONATIONS_URL}"`, "g"))).toHaveLength(2);
    expect(html.match(/target="_blank"/g)).toHaveLength(2);
    expect(html.match(/rel="noopener noreferrer"/g)).toHaveLength(2);
    expect(html.match(/aria-label="Открыть DonationAlerts"/g)).toHaveLength(2);
  });
});
