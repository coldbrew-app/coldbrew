import { createFileRoute } from "@tanstack/react-router";
import { CosmicPageHeader } from "@web/components/cosmic-page-header";

import { createTranslator, useI18n } from "../../lib/i18n";

export const Route = createFileRoute("/_authenticated/alerts")({
  component: RouteComponent,
  head: ({ match }) => ({
    meta: [{ title: `${createTranslator(match.context.locale)("alerts")} · Coldbrew` }],
  }),
});

function RouteComponent() {
  const { t } = useI18n();
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
