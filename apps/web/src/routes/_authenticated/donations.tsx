import { createFileRoute, Outlet } from "@tanstack/react-router";
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
    <section className="flex min-w-0 flex-1 flex-col">
      <div className="w-full">
        <article className="mt-4 overflow-hidden rounded-2xl border border-border bg-card shadow-sm shadow-primary/5">
          <div className="flex flex-col gap-4 border-b border-border p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-heading text-lg font-semibold text-card-foreground">
                  {t("allDonations")}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">{t("browseDonations")}</p>
              </div>
              <div className="flex items-center gap-2">
                <Icons.filter aria-hidden="true" size={15} className="text-primary" />
                <span className="text-xs font-semibold text-muted-foreground">DonationAlerts</span>
              </div>
            </div>
          </div>

          <Outlet />
        </article>
      </div>
    </section>
  );
}
