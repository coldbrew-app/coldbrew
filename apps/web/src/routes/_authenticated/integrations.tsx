import { createFileRoute } from "@tanstack/react-router";
import { CosmicPageHeader } from "@web/components/cosmic-page-header";
import {
  DonationAlertsConnectionStatus,
  DonationAlertsMark,
  DonationAlertsNameLink,
} from "@web/components/donation-alerts";
import { Icons } from "@web/components/icons";
import { Button } from "@web/components/ui/button";
import { preloadRouteQuery } from "@web/lib/trpc";

import { useAuthUrlQ, useDisconnectM, useUserInfoSafe } from "../../hooks/api";
import { createI18n, createTranslator, useI18n } from "../../lib/i18n";

const i18n = createI18n({
  integrations: {
    en: "Integrations",
    ru: "Интеграции",
  },
  integrationsEyebrow: {
    en: "Donation sources",
    ru: "Источники донатов",
  },
  integrationsDescription: {
    en: "Connect services to keep all your donations in one place.",
    ru: "Подключите сервисы, чтобы собирать все донаты в одном месте.",
  },
  donationsSyncing: {
    en: "New DonationAlerts donations sync automatically.",
    ru: "Новые донаты из DonationAlerts загружаются автоматически.",
  },
  importDonations: {
    en: "Automatically import donations from DonationAlerts.",
    ru: "Подключите DonationAlerts, чтобы донаты загружались автоматически.",
  },
  disconnecting: {
    en: "Disconnecting…",
    ru: "Отключаем…",
  },
  disconnect: {
    en: "Disconnect",
    ru: "Отключить",
  },
  connectDonationAlerts: {
    en: "Connect DonationAlerts",
    ru: "Подключить DonationAlerts",
  },
  secureAuthorization: {
    en: "Sign in to DonationAlerts to securely grant Coldbrew access.",
    ru: "Войдите в DonationAlerts и разрешите Coldbrew получать ваши донаты.",
  },
  secureConnection: {
    en: "Coldbrew has secure access to your DonationAlerts account.",
    ru: "Coldbrew получает донаты из вашего аккаунта DonationAlerts.",
  },
  moreIntegrationsSoon: {
    en: "More integrations are coming soon.",
    ru: "Скоро добавим другие сервисы.",
  },
  loadingAuthorization: {
    en: "Loading authorization…",
    ru: "Получаем ссылку…",
  },
  authorizationUnavailable: {
    en: "Authorization is unavailable",
    ru: "Не удалось получить ссылку",
  },
});

export const Route = createFileRoute("/_authenticated/integrations")({
  component: RouteComponent,
  head: ({ match }) => ({
    meta: [{ title: `${createTranslator(match.context.locale, i18n)("integrations")} · Coldbrew` }],
  }),
  loader: async ({ context }) => {
    if (!context.viewer) {
      return;
    }
    await preloadRouteQuery(context.queryClient, context.trpc.authUrls.queryOptions());
  },
});

function RouteComponent() {
  const userInfo = useUserInfoSafe();
  const connected = userInfo !== null && userInfo.hasDonationAlertsConnection;
  const authUrlQ = useAuthUrlQ(!connected);

  const disconnectM = useDisconnectM();
  const { t } = useI18n(i18n);

  return (
    <section className="cosmic-panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <CosmicPageHeader
        description={t("integrationsDescription")}
        eyebrow={t("integrationsEyebrow")}
        title={t("integrations")}
        variant="beans"
      />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-4 sm:p-5">
        <article className="cosmic-panel shrink-0 overflow-hidden">
          <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:p-6">
            <DonationAlertsMark size="lg" />
            <div className="min-w-0 grow">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-heading text-lg font-semibold text-card-foreground">
                  <DonationAlertsNameLink />
                </h2>
                <DonationAlertsConnectionStatus connected={connected} />
              </div>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {connected ? t("donationsSyncing") : t("importDonations")}
              </p>
            </div>
            {connected ? (
              <Button
                variant="destructive"
                size="lg"
                disabled={disconnectM.isPending}
                onClick={() => disconnectM.mutate({ source: "donationalerts" })}
              >
                {t(disconnectM.isPending ? "disconnecting" : "disconnect")}
              </Button>
            ) : authUrlQ.data ? (
              <Button
                render={<a href={authUrlQ.data.donationAlerts} />}
                className="w-full shrink-0 sm:w-auto"
                size="lg"
              >
                {t("connectDonationAlerts")}
                <Icons.chevronRight aria-hidden="true" size={16} />
              </Button>
            ) : (
              <Button
                className="w-full sm:w-auto"
                disabled={authUrlQ.isLoading}
                onClick={() => void authUrlQ.refetch()}
                size="lg"
                type="button"
                variant={authUrlQ.isError ? "outline" : "default"}
              >
                {authUrlQ.isLoading ? (
                  <Icons.loader aria-hidden="true" className="animate-spin" />
                ) : (
                  <Icons.retry aria-hidden="true" />
                )}
                {t(authUrlQ.isLoading ? "loadingAuthorization" : "authorizationUnavailable")}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2 border-t border-border bg-muted/55 px-5 py-3 text-xs text-muted-foreground sm:px-6">
            <Icons.secure aria-hidden="true" size={15} className="shrink-0 text-primary" />
            {t(connected ? "secureConnection" : "secureAuthorization")}
          </div>
        </article>

        <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
          <Icons.checked aria-hidden="true" size={15} className="text-primary" />
          {t("moreIntegrationsSoon")}
        </div>
      </div>
    </section>
  );
}
