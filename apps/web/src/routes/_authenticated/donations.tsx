import { createFileRoute, Outlet } from "@tanstack/react-router";
import { CosmicPageHeader } from "@web/components/cosmic-page-header";
import { DonateStreamSourceBadge } from "@web/components/donate-stream";
import { DonationSourceBadge } from "@web/components/donation-source";
import { Icons } from "@web/components/icons";

import { createI18n, createTranslator, useI18n } from "../../lib/i18n";

const i18n = createI18n({
  donations: {
    en: "Donations",
    ru: "Донаты",
  },
  allDonations: {
    en: "All donations",
    ru: "Все донаты",
  },
  browseDonations: {
    en: "Browse and search your supporters’ donations.",
    ru: "Просматривайте донаты и находите нужные по имени или сообщению.",
  },
});

export const Route = createFileRoute("/_authenticated/donations")({
  component: DonationsLayout,
  head: ({ match }) => ({
    meta: [{ title: `${createTranslator(match.context.locale, i18n)("donations")} · Coldbrew` }],
  }),
});

function DonationsLayout() {
  const { t } = useI18n(i18n);

  return (
    <section className="cosmic-panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <CosmicPageHeader
        description={t("browseDonations")}
        title={t("allDonations")}
        actions={
          <div className="flex items-center gap-2">
            <Icons.filter aria-hidden="true" size={15} />
            <DonationSourceBadge source="donationalerts" />
            <DonateStreamSourceBadge />
            <DonationSourceBadge source="streamlabs" />
          </div>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </div>
    </section>
  );
}
