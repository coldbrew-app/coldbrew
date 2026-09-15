import { DonationSourceSchema } from "@streambrew/packages/schemas.js";
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
    meta: [
      { title: `${createTranslator(match.context.locale, i18n)("integrations")} · StreamBrew` },
    ],
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

function ConnectionNotice() {
  const search = Route.useSearch();
  const { t } = useI18n(i18n);
  if (search.success === undefined || search.source === undefined) return null;
  return (
    <div
      className={`rounded-xl border px-3.5 py-3 text-[13px] ${search.success ? "border-emerald-300/50 bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300" : "border-red-300/50 bg-red-50 text-red-700 dark:bg-red-400/10 dark:text-red-300"}`}
      role="status"
    >
      {t(search.success ? "connectedSuccessfully" : "connectionFailed", {
        source: donationSourceDetails(search.source).name,
      })}
    </div>
  );
}

type DisconnectMutation = ReturnType<typeof useDisconnectM>;
type AuthUrlQuery = ReturnType<typeof useAuthUrlQ>;
type OAuthDonationSource = "donationalerts" | "streamlabs";

function DonationConnectionAction({
  authUrl,
  authUrlQ,
  connected,
  disconnectM,
  source,
}: {
  authUrl?: string;
  authUrlQ: AuthUrlQuery;
  connected: boolean;
  disconnectM: DisconnectMutation;
  source: OAuthDonationSource;
}) {
  const { t } = useI18n(i18n);
  const disconnecting = disconnectM.isPending && disconnectM.variables?.source === source;
  if (connected) {
    const label = t(disconnecting ? "disconnecting" : "disconnect");
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label={label}
              className="shrink-0"
              disabled={disconnecting}
              onClick={() => disconnectM.mutate({ source })}
              size="icon"
              variant="destructive"
            >
              {disconnecting ? (
                <Icons.loader aria-hidden="true" className="animate-spin" />
              ) : (
                <Icons.disconnectSource aria-hidden="true" />
              )}
            </Button>
          }
        />
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    );
  }
  if (authUrl) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label={t("connect")}
              className="shrink-0"
              nativeButton={false}
              render={<a href={authUrl} />}
              size="icon"
            >
              <Icons.connectSource aria-hidden="true" />
            </Button>
          }
        />
        <TooltipContent>{t("connect")}</TooltipContent>
      </Tooltip>
    );
  }
  return (
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
  );
}

function DonationIntegrationCard({
  authUrl,
  authUrlQ,
  connected,
  disconnectM,
  source,
}: {
  authUrl?: string;
  authUrlQ: AuthUrlQuery;
  connected: boolean;
  disconnectM: DisconnectMutation;
  source: OAuthDonationSource;
}) {
  return (
    <article className="cosmic-panel flex items-center gap-3 overflow-hidden p-3">
      <DonationSourceMark source={source} />
      <h2 className="min-w-0 grow font-heading text-base font-semibold text-card-foreground">
        <DonationSourceNameLink source={source} />
      </h2>
      <DonationConnectionAction
        authUrl={authUrl}
        authUrlQ={authUrlQ}
        connected={connected}
        disconnectM={disconnectM}
        source={source}
      />
    </article>
  );
}

function DonateStreamCard({
  connected,
  disconnectM,
  onConnect,
}: {
  connected: boolean;
  disconnectM: DisconnectMutation;
  onConnect: () => void;
}) {
  const { t } = useI18n(i18n);
  const disconnecting = disconnectM.isPending && disconnectM.variables?.source === "donate_stream";
  const label = t(disconnecting ? "disconnecting" : connected ? "disconnect" : "connect");
  return (
    <article className="cosmic-panel flex items-center gap-3 overflow-hidden p-3">
      <DonateStreamMark />
      <h2 className="min-w-0 grow font-heading text-base font-semibold text-card-foreground">
        <DonateStreamNameLink />
      </h2>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label={label}
              className="shrink-0"
              disabled={disconnecting}
              onClick={
                connected ? () => disconnectM.mutate({ source: "donate_stream" }) : onConnect
              }
              size="icon"
              type="button"
              variant={connected ? "destructive" : "default"}
            >
              {disconnecting ? (
                <Icons.loader aria-hidden="true" className="animate-spin" />
              ) : connected ? (
                <Icons.disconnectSource aria-hidden="true" />
              ) : (
                <Icons.connectSource aria-hidden="true" />
              )}
            </Button>
          }
        />
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </article>
  );
}

function RouteComponent() {
  const userInfo = useUserInfoSafe();
  const authUrlQ = useAuthUrlQ();
  const [showDonateStreamForm, setShowDonateStreamForm] = useState(false);
  const disconnectM = useDisconnectM();
  const { t } = useI18n(i18n);

  return (
    <section className="cosmic-panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <CosmicPageHeader title={t("integrations")} variant="beans" />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-3 sm:p-4">
        <ConnectionNotice />
        <div className="grid shrink-0 gap-3 lg:grid-cols-2 xl:grid-cols-3">
          <DonationIntegrationCard
            authUrl={authUrlQ.data?.donationAlerts}
            authUrlQ={authUrlQ}
            connected={userInfo?.hasDonationAlertsConnection ?? false}
            disconnectM={disconnectM}
            source="donationalerts"
          />
          <DonationIntegrationCard
            authUrl={authUrlQ.data?.streamlabs}
            authUrlQ={authUrlQ}
            connected={userInfo?.hasStreamlabsConnection ?? false}
            disconnectM={disconnectM}
            source="streamlabs"
          />
          <DonateStreamCard
            connected={userInfo?.hasDonateStreamConnection ?? false}
            disconnectM={disconnectM}
            onConnect={() => setShowDonateStreamForm(true)}
          />
        </div>
      </div>
      {showDonateStreamForm && (
        <DonateStreamConnectionForm onClose={() => setShowDonateStreamForm(false)} />
      )}
    </section>
  );
}
