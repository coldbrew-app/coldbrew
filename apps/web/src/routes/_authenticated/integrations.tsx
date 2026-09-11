import { DonationSourceSchema } from "@coldbrew/packages/schemas.js";
import { createFileRoute } from "@tanstack/react-router";
import { CosmicPageHeader } from "@web/components/cosmic-page-header";
import { DonateStreamMark, DonateStreamNameLink } from "@web/components/donate-stream";
import { DonateStreamConnectionForm } from "@web/components/donate-stream-connection-form";
import {
  donationSourceDetails,
  DonationSourceMark,
  DonationSourceNameLink,
} from "@web/components/donation-source";
import { Icons } from "@web/components/icons";
import { Button } from "@web/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@web/components/ui/tooltip";
import { preloadRouteQuery } from "@web/lib/trpc";
import { useState } from "react";
import { z } from "zod";

import { useAuthUrlQ, useDisconnectM, useUserInfoSafe } from "../../hooks/api";
import { createI18n, createTranslator, useI18n } from "../../lib/i18n";

const i18n = createI18n({
  integrations: { en: "Integrations", ru: "Интеграции" },
  disconnecting: { en: "Disconnecting…", ru: "Отключаем…" },
  disconnect: { en: "Disconnect", ru: "Отключить" },
  connect: { en: "Connect", ru: "Подключить" },
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
      source: "donationalerts" as const,
    },
    {
      authUrl: authUrlQ.data?.streamlabs,
      connected: userInfo?.hasStreamlabsConnection ?? false,
      source: "streamlabs" as const,
    },
  ];

  return (
    <section className="cosmic-panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <CosmicPageHeader title={t("integrations")} variant="beans" />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-3 sm:p-4">
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

        <div className="grid shrink-0 gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {integrations.map(({ authUrl, connected, source }) => {
            const disconnecting = disconnectM.isPending && disconnectM.variables?.source === source;
            return (
              <article
                className="cosmic-panel flex items-center gap-3 overflow-hidden p-3"
                key={source}
              >
                <DonationSourceMark source={source} />
                <h2 className="min-w-0 grow font-heading text-base font-semibold text-card-foreground">
                  <DonationSourceNameLink source={source} />
                </h2>
                {connected ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          aria-label={t(disconnecting ? "disconnecting" : "disconnect")}
                          className="shrink-0"
                          variant="destructive"
                          size="icon"
                          disabled={disconnecting}
                          onClick={() => disconnectM.mutate({ source })}
                        >
                          {disconnecting ? (
                            <Icons.loader aria-hidden="true" className="animate-spin" />
                          ) : (
                            <Icons.disconnectSource aria-hidden="true" />
                          )}
                        </Button>
                      }
                    />
                    <TooltipContent>
                      {t(disconnecting ? "disconnecting" : "disconnect")}
                    </TooltipContent>
                  </Tooltip>
                ) : authUrl ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          aria-label={t("connect")}
                          render={<a href={authUrl} />}
                          className="shrink-0"
                          nativeButton={false}
                          size="icon"
                        >
                          <Icons.connectSource aria-hidden="true" />
                        </Button>
                      }
                    />
                    <TooltipContent>{t("connect")}</TooltipContent>
                  </Tooltip>
                ) : (
                  <Button
                    className="shrink-0"
                    disabled={authUrlQ.isLoading}
                    onClick={() => void authUrlQ.refetch()}
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
              </article>
            );
          })}

          <article className="cosmic-panel flex items-center gap-3 overflow-hidden p-3">
            <DonateStreamMark />
            <h2 className="min-w-0 grow font-heading text-base font-semibold text-card-foreground">
              <DonateStreamNameLink />
            </h2>
            {donateStreamConnected ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      aria-label={t(
                        disconnectM.isPending && disconnectM.variables?.source === "donate_stream"
                          ? "disconnecting"
                          : "disconnect",
                      )}
                      className="shrink-0"
                      variant="destructive"
                      size="icon"
                      disabled={
                        disconnectM.isPending && disconnectM.variables?.source === "donate_stream"
                      }
                      onClick={() => disconnectM.mutate({ source: "donate_stream" })}
                    >
                      {disconnectM.isPending &&
                      disconnectM.variables?.source === "donate_stream" ? (
                        <Icons.loader aria-hidden="true" className="animate-spin" />
                      ) : (
                        <Icons.disconnectSource aria-hidden="true" />
                      )}
                    </Button>
                  }
                />
                <TooltipContent>
                  {t(
                    disconnectM.isPending && disconnectM.variables?.source === "donate_stream"
                      ? "disconnecting"
                      : "disconnect",
                  )}
                </TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      aria-label={t("connect")}
                      className="shrink-0"
                      onClick={() => setShowDonateStreamForm(true)}
                      size="icon"
                      type="button"
                    >
                      <Icons.connectSource aria-hidden="true" />
                    </Button>
                  }
                />
                <TooltipContent>{t("connect")}</TooltipContent>
              </Tooltip>
            )}
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
