import { createFileRoute } from "@tanstack/react-router";

import { createTranslator, useI18n } from "../lib/i18n";

export const Route = createFileRoute("/alerts")({
  component: RouteComponent,
  head: ({ match }) => ({
    meta: [{ title: `${createTranslator(match.context.locale)("alerts")} · Coldbrew` }],
  }),
});

function RouteComponent() {
  const { t } = useI18n();
  return <div>{t("underConstruction")}</div>;
}
