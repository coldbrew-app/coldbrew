import { createFileRoute } from "@tanstack/react-router";

import { useI18n } from "../lib/i18n";

export const Route = createFileRoute("/alerts")({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useI18n();
  return <div>{t("underConstruction")}</div>;
}
