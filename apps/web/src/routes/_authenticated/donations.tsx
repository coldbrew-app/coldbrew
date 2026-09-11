import { createFileRoute, Outlet } from "@tanstack/react-router";

import { createI18n, createTranslator } from "../../lib/i18n";

const i18n = createI18n({
  donations: {
    en: "Donations",
    ru: "Донаты",
  },
});

export const Route = createFileRoute("/_authenticated/donations")({
  component: DonationsLayout,
  head: ({ match }) => ({
    meta: [{ title: `${createTranslator(match.context.locale, i18n)("donations")} · Coldbrew` }],
  }),
});

function DonationsLayout() {
  return (
    <section className="cosmic-panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </div>
    </section>
  );
}
