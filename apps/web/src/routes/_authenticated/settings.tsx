import { createFileRoute } from "@tanstack/react-router";
import { CosmicPageHeader } from "@web/components/cosmic-page-header";
import { PublicQueueSettingsEditor } from "@web/components/public-queue-settings-editor";
import { QueueCurrencyEditor } from "@web/components/queue-currency-editor";

import { createTranslator, useI18n } from "../../lib/i18n";

export const Route = createFileRoute("/_authenticated/settings")({
  component: Settings,
  head: ({ match }) => ({
    meta: [{ title: `${createTranslator(match.context.locale)("settings")} · Coldbrew` }],
  }),
});

function Settings() {
  const { t } = useI18n();

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4">
      <CosmicPageHeader
        description={t("settingsDescription")}
        eyebrow={t("queueOrbit")}
        title={t("settings")}
        variant="beans"
      />
      <PublicQueueSettingsEditor />
      <QueueCurrencyEditor />
    </main>
  );
}
