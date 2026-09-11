import { DonationSourceSchema } from "@coldbrew/packages/schemas.js";
import { createFileRoute } from "@tanstack/react-router";
import { CosmicPageHeader } from "@web/components/cosmic-page-header";
import {
  DonateStreamConnectionStatus,
  DonateStreamMark,
  DonateStreamNameLink,
} from "@web/components/donate-stream";
import { DonateStreamConnectionForm } from "@web/components/donate-stream-connection-form";
import { DonationAlertsConnectionStatus } from "@web/components/donation-alerts";
import {
  donationSourceDetails,
  DonationSourceMark,
  DonationSourceNameLink,
} from "@web/components/donation-source";
import { Icons } from "@web/components/icons";
import { StreamlabsConnectionStatus } from "@web/components/streamlabs";
import { Button } from "@web/components/ui/button";
import { preloadRouteQuery } from "@web/lib/trpc";
import { useState } from "react";
import { z } from "zod";

import { useAuthUrlQ, useDisconnectM, useUserInfoSafe } from "../../hooks/api";
import { createI18n, createTranslator, useI18n } from "../../lib/i18n";

const i18n = createI18n({
  integrations: { en: "Integrations", ru: "Интеграции" },
  integrationsEyebrow: { en: "Donation sources", ru: "Источники донатов" },
  integrationsDescription: {
    en: "Connect services to keep all your donations in one place.",
    ru: "Подключите сервисы, чтобы собирать все донаты в одном месте.",
  },
  donationsSyncing: {
    en: ({ source }: { source: string }) => `New donations from ${source} sync automatically.`,
    ru: ({ source }: { source: string }) => `Новые донаты из ${source} загружаются автоматически.`,
  },
  donateStreamSyncing: {
    en: "New donate.stream donations sync automatically.",
    ru: "Новые донаты из donate.stream загружаются автоматически.",
  },
  importDonations: {
    en: ({ source }: { source: string }) => `Automatically import donations from ${source}.`,
    ru: ({ source }: { source: string }) =>
      `Подключите ${source}, чтобы донаты загружались автоматически.`,
  },
  importDonateStream: {
    en: "Connect donate.stream to receive new donations in real time.",
    ru: "Подключите donate.stream, чтобы получать новые донаты в реальном времени.",
  },
  disconnecting: { en: "Disconnecting…", ru: "Отключаем…" },
  disconnect: { en: "Disconnect", ru: "Отключить" },
  connect: {
    en: ({ source }: { source: string }) => `Connect ${source}`,
    ru: ({ source }: { source: string }) => `Подключить ${source}`,
  },
  connectDonateStream: { en: "Connect donate.stream", ru: "Подключить donate.stream" },
  secureAuthorization: {
    en: ({ source }: { source: string }) =>
      `Sign in to ${source} to securely grant Coldbrew access.`,
    ru: ({ source }: { source: string }) =>
      `Войдите в ${source} и разрешите Coldbrew получать ваши донаты.`,
  },
  secureConnection: {
    en: ({ source }: { source: string }) => `Coldbrew has secure access to your ${source} account.`,
    ru: ({ source }: { source: string }) =>
      `Coldbrew получает донаты из вашего аккаунта ${source}.`,
  },
  tokenConnection: {
    en: "Connection via your donate.stream alert widget address.",
    ru: "Подключение по адресу виджета оповещений donate.stream.",
  },
  donateStreamConnected: {
    en: "Coldbrew receives donations from your donate.stream account.",
    ru: "Coldbrew получает донаты из вашего аккаунта donate.stream.",
  },
  connectAnySource: {
    en: "Connect any source or all of them — donations from different sources remain isolated.",
    ru: "Можно подключить один источник или все сразу — донаты из разных источников не смешиваются.",
  },
  loadingAuthorization: { en: "Loading authorization…", ru: "Получаем ссылку…" },
  authorizationUnavailable: {
    en: "Authorization is unavailable",
    ru: "Не удалось получить ссылку",
  },
  connectedSuccessfully: {
    en: ({ source }: { source: string }) => `${source} is connected. Donation sync has started.`,
    ru: ({ source }: { source: string }) => `${source} подключён. Синхронизация донатов запущена.`,
  },
  connectionFailed: {
    en: ({ source }: { source: string }) => `${source} could not be connected. Please try again.`,
    ru: ({ source }: { source: string }) => `Не удалось подключить ${source}. Попробуйте ещё раз.`,
  },
});

export const Route = createFileRoute("/_authenticated/integrations")({
  component: RouteComponent,
  head: ({ match }) => ({
    meta: [{ title: `${createTranslator(match.context.locale, i18n)("integrations")} · Coldbrew` }],
  }),
  loader: async ({ context }) => {
    if (!context.viewer) return;
    await preloadRouteQuery(context.queryClient, context.trpc.authUrls.queryOptions());
  },
  validateSearch: z.object({
    source: DonationSourceSchema.optional(),
    success: z.boolean().optional(),
  }),
});

function RouteComponent() {
  const userInfo = useUserInfoSafe();
  const donateStreamConnected = userInfo?.hasDonateStreamConnection ?? false;
  const authUrlQ = useAuthUrlQ();
  const [showDonateStreamForm, setShowDonateStreamForm] = useState(false);
  const disconnectM = useDisconnectM();
  const search = Route.useSearch();
  const { t } = useI18n(i18n);
  const integrations = [
    {
      authUrl: authUrlQ.data?.donationAlerts,
      connected: userInfo?.hasDonationAlertsConnection ?? false,
      ConnectionStatus: DonationAlertsConnectionStatus,
      name: donationSourceDetails("donationalerts").name,
      source: "donationalerts" as const,
    },
    {
      authUrl: authUrlQ.data?.streamlabs,
      connected: userInfo?.hasStreamlabsConnection ?? false,
      ConnectionStatus: StreamlabsConnectionStatus,
      name: donationSourceDetails("streamlabs").name,
      source: "streamlabs" as const,
    },
  ];

  return (
    <section className="cosmic-panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <CosmicPageHeader
        description={t("integrationsDescription")}
        eyebrow={t("integrationsEyebrow")}
        title={t("integrations")}
        variant="beans"
      />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-4 sm:p-5">
        {search.success !== undefined && search.source !== undefined && (
          <div
            className={`rounded-xl border px-3.5 py-3 text-[13px] ${search.success ? "border-emerald-300/50 bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300" : "border-red-300/50 bg-red-50 text-red-700 dark:bg-red-400/10 dark:text-red-300"}`}
            role="status"
          >
            {t(search.success ? "connectedSuccessfully" : "connectionFailed", {
              source: donationSourceDetails(search.source).name,
            })}
          </div>
        )}

        <div className="grid shrink-0 gap-4 xl:grid-cols-2">
          {integrations.map(({ authUrl, connected, ConnectionStatus, name, source }) => {
            const disconnecting = disconnectM.isPending && disconnectM.variables?.source === source;
            return (
              <article
                className="cosmic-panel flex min-h-[230px] flex-col overflow-hidden"
                key={source}
              >
                <div className="flex grow flex-col gap-5 p-5 sm:p-6">
                  <div className="flex items-start gap-4">
                    <DonationSourceMark size="lg" source={source} />
                    <div className="min-w-0 grow">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-heading text-lg font-semibold text-card-foreground">
                          <DonationSourceNameLink source={source} />
                        </h2>
                        <ConnectionStatus connected={connected} />
                      </div>
                      <p className="pt-1.5 text-sm leading-6 text-muted-foreground">
                        {t(connected ? "donationsSyncing" : "importDonations", { source: name })}
                      </p>
                    </div>
                  </div>
                  <div className="flex grow items-end">
                    {connected ? (
                      <Button
                        className="w-full sm:w-auto"
                        variant="destructive"
                        size="lg"
                        disabled={disconnecting}
                        onClick={() => disconnectM.mutate({ source })}
                      >
                        {t(disconnecting ? "disconnecting" : "disconnect")}
                      </Button>
                    ) : authUrl ? (
                      <Button
                        render={<a href={authUrl} />}
                        className="w-full shrink-0 sm:w-auto"
                        nativeButton={false}
                        size="lg"
                      >
                        {t("connect", { source: name })}
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
                        {t(
                          authUrlQ.isLoading ? "loadingAuthorization" : "authorizationUnavailable",
                        )}
                      </Button>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 border-t border-border bg-muted/55 px-5 py-3 text-xs text-muted-foreground sm:px-6">
                  <Icons.secure aria-hidden="true" size={15} className="shrink-0 text-primary" />
                  {t(connected ? "secureConnection" : "secureAuthorization", { source: name })}
                </div>
              </article>
            );
          })}

          <article className="cosmic-panel flex min-h-[230px] flex-col overflow-hidden">
            <div className="flex grow flex-col gap-5 p-5 sm:p-6">
              <div className="flex items-start gap-4">
                <DonateStreamMark size="lg" />
                <div className="min-w-0 grow">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-heading text-lg font-semibold text-card-foreground">
                      <DonateStreamNameLink />
                    </h2>
                    <DonateStreamConnectionStatus connected={donateStreamConnected} />
                  </div>
                  <p className="pt-1.5 text-sm leading-6 text-muted-foreground">
                    {t(donateStreamConnected ? "donateStreamSyncing" : "importDonateStream")}
                  </p>
                </div>
              </div>
              <div className="flex grow items-end">
                {donateStreamConnected ? (
                  <Button
                    className="w-full sm:w-auto"
                    variant="destructive"
                    size="lg"
                    disabled={
                      disconnectM.isPending && disconnectM.variables?.source === "donate_stream"
                    }
                    onClick={() => disconnectM.mutate({ source: "donate_stream" })}
                  >
                    {t(
                      disconnectM.isPending && disconnectM.variables?.source === "donate_stream"
                        ? "disconnecting"
                        : "disconnect",
                    )}
                  </Button>
                ) : (
                  <Button
                    className="w-full shrink-0 sm:w-auto"
                    onClick={() => setShowDonateStreamForm(true)}
                    size="lg"
                    type="button"
                  >
                    {t("connectDonateStream")}
                    <Icons.chevronRight aria-hidden="true" size={16} />
                  </Button>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 border-t border-border bg-muted/55 px-5 py-3 text-xs text-muted-foreground sm:px-6">
              <Icons.secure aria-hidden="true" size={15} className="shrink-0 text-primary" />
              {t(donateStreamConnected ? "donateStreamConnected" : "tokenConnection")}
            </div>
          </article>
        </div>

        <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
          <Icons.checked aria-hidden="true" size={15} className="shrink-0 text-primary" />
          {t("connectAnySource")}
        </div>
      </div>
      {showDonateStreamForm && (
        <DonateStreamConnectionForm onClose={() => setShowDonateStreamForm(false)} />
      )}
    </section>
  );
}
