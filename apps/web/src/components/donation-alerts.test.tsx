import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/i18n")>();
  return {
    ...actual,
    useI18n: () => ({ locale: "ru", t: actual.createTranslator("ru") }),
  };
});

import { DONATION_ALERTS_DONATIONS_URL, DonationAlertsSourceBadge } from "./donation-alerts";

describe("DonationAlerts source badge", () => {
  it("opens the donation source dashboard in a separate tab", () => {
    const html = renderToStaticMarkup(<DonationAlertsSourceBadge />);

    expect(html).toContain(`href="${DONATION_ALERTS_DONATIONS_URL}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('aria-label="Открыть DonationAlerts"');
  });
});
