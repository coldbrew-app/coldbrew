import { createFileRoute } from "@tanstack/react-router";

import { useI18n } from "../lib/i18n";

export const Route = createFileRoute("/settings")({
  component: Settings,
});

function Settings() {
  const { t } = useI18n();
  return <main>{t("settings")}</main>;
}
