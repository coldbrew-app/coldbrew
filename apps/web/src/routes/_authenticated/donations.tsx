import { createFileRoute, Outlet } from "@tanstack/react-router";
import { CosmicPageHeader } from "@web/components/cosmic-page-header";
import { DonationAlertsSourceBadge } from "@web/components/donation-alerts";
import { Icons } from "@web/components/icons";

import { createTranslator, useI18n } from "../../lib/i18n";

export const Route = createFileRoute("/_authenticated/donations")({
  component: DonationsLayout,
  head: ({ match }) => ({
    meta: [{ title: `${createTranslator(match.context.locale)("donations")} · Coldbrew` }],
  }),
});

function DonationsLayout() {
  const { t } = useI18n();

  return (
    <section className="cosmic-panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <CosmicPageHeader
        description={t("browseDonations")}
        title={t("allDonations")}
        actions={
          <div className="flex items-center gap-2">
            <Icons.filter aria-hidden="true" size={15} />
            <DonationAlertsSourceBadge />
          </div>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </div>
    </section>
  );
}
