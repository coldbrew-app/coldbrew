import { createFileRoute } from "@tanstack/react-router";
import { CosmicPageHeader } from "@web/components/cosmic-page-header";

import { createI18n, createTranslator, useI18n } from "../../lib/i18n";

const i18n = createI18n({
  alerts: {
    en: "Alerts",
    ru: "Оповещения",
  },
  activeDevelopment: {
    en: "Coldbrew is under active development. Breaking changes and data loss are possible.",
    ru: "Coldbrew активно разрабатывается. Возможны несовместимые изменения и потеря данных.",
  },
  underConstruction: {
    en: "Under construction",
    ru: "В разработке",
  },
  alertsEyebrow: {
    en: "Stream reactions",
    ru: "Реакции на стриме",
  },
});

export const Route = createFileRoute("/_authenticated/alerts")({
  component: RouteComponent,
  head: ({ match }) => ({
    meta: [{ title: `${createTranslator(match.context.locale, i18n)("alerts")} · Coldbrew` }],
  }),
});

function RouteComponent() {
  const { t } = useI18n(i18n);
  return (
    <section className="cosmic-panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <CosmicPageHeader
        description={t("activeDevelopment")}
        eyebrow={t("alertsEyebrow")}
        title={t("alerts")}
        variant="beans"
      />
      <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto overscroll-contain p-6 text-sm text-muted-foreground">
        {t("underConstruction")}
      </div>
    </section>
  );
}
