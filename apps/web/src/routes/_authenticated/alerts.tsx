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
    <section className="flex min-w-0 flex-1 flex-col gap-4">
      <CosmicPageHeader
        description={t("activeDevelopment")}
        eyebrow={t("orbitCaption")}
        title={t("alerts")}
        variant="beans"
      />
      <div className="cosmic-panel grid min-h-52 place-items-center p-6 text-sm text-muted-foreground">
        {t("underConstruction")}
      </div>
    </section>
  );
}
