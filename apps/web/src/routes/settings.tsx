import { createFileRoute } from "@tanstack/react-router";

import { createTranslator, useI18n } from "../lib/i18n";

export const Route = createFileRoute("/settings")({
  component: Settings,
  head: ({ match }) => ({
    meta: [{ title: `${createTranslator(match.context.locale)("settings")} · Coldbrew` }],
  }),
});

function Settings() {
  const { t } = useI18n();
  return <main>{t("settings")}</main>;
}
