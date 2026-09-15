import {
  type DonationSourceConnectionStatus,
  DonationSourceSchema,
} from "@streambrew/packages/schemas.js";
import { createFileRoute } from "@tanstack/react-router";
import { CosmicPageHeader } from "@web/components/cosmic-page-header";
import { DonateStreamConnectionForm } from "@web/components/donate-stream-connection-form";
import {
  donationSourceDetails,
  DonationSourceMark,
  DonationSourceNameLink,
} from "@web/components/donation-source";
import { Icons } from "@web/components/icons";
import { TourniquetConnectionForm } from "@web/components/tourniquet-connection-form";
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
  disconnectFailed: {
    en: ({ source }: { source: string }) =>
      `${source} could not be disconnected. Please try again.`,
    ru: ({ source }: { source: string }) => `Не удалось отключить ${source}. Попробуйте ещё раз.`,
  },
  connectSource: {
    en: ({ source }: { source: string }) => `Connect ${source}`,
    ru: ({ source }: { source: string }) => `Подключить ${source}`,
  },
  disconnectSource: {
    en: ({ source }: { source: string }) => `Disconnect ${source}`,
    ru: ({ source }: { source: string }) => `Отключить ${source}`,
  },
  authorizationExpired: {
    en: "Authorization expired. Connect again to resume synchronization.",
    ru: "Авторизация истекла. Подключите источник заново, чтобы продолжить синхронизацию.",
  },
  synchronizationStopped: {
    en: "Synchronization stopped because of an integration error. Connect again to retry.",
    ru: "Синхронизация остановлена из-за ошибки интеграции. Подключите источник заново.",
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
type OAuthDonationSource = "donationalerts" | "streamlabs" | "streamelements";
type WidgetDonationSource = "donate_stream" | "tourniquet";

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
  const sourceName = donationSourceDetails(source).name;
  const disconnecting = disconnectM.isPending && disconnectM.variables?.source === source;
  if (connected) {
    const label = disconnecting
      ? t("disconnecting")
      : t("disconnectSource", { source: sourceName });
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
    const label = t("connectSource", { source: sourceName });
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label={label}
              className="shrink-0"
              nativeButton={false}
              render={<a href={authUrl} />}
              size="icon"
            >
              <Icons.connectSource aria-hidden="true" />
            </Button>
          }
        />
        <TooltipContent>{label}</TooltipContent>
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
  connectionIssue,
  connected,
  disconnectM,
  source,
}: {
  authUrl?: string;
  authUrlQ: AuthUrlQuery;
  connectionIssue?: string;
  connected: boolean;
  disconnectM: DisconnectMutation;
  source: OAuthDonationSource;
}) {
  return (
    <article className="cosmic-panel flex items-center gap-3 overflow-hidden p-3">
      <DonationSourceMark source={source} />
      <div className="flex min-w-0 grow flex-col gap-0.5">
        <h2 className="font-heading text-base font-semibold text-card-foreground">
          <DonationSourceNameLink source={source} />
        </h2>
        {connectionIssue && (
          <p className="text-xs leading-snug text-destructive" role="status">
            {connectionIssue}
          </p>
        )}
      </div>
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

function WidgetIntegrationCard({
  connected,
  disconnectM,
  onConnect,
  source,
}: {
  connected: boolean;
  disconnectM: DisconnectMutation;
  onConnect: () => void;
  source: WidgetDonationSource;
}) {
  const { t } = useI18n(i18n);
  const disconnecting = disconnectM.isPending && disconnectM.variables?.source === source;
  const label = disconnecting
    ? t("disconnecting")
    : t(connected ? "disconnectSource" : "connectSource", {
        source: donationSourceDetails(source).name,
      });
  return (
    <article className="cosmic-panel flex items-center gap-3 overflow-hidden p-3">
      <DonationSourceMark source={source} />
      <h2 className="min-w-0 grow font-heading text-base font-semibold text-card-foreground">
        <DonationSourceNameLink source={source} />
      </h2>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label={label}
              className="shrink-0"
              disabled={disconnecting}
              onClick={connected ? () => disconnectM.mutate({ source }) : onConnect}
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

function DisconnectError({ disconnectM }: { disconnectM: DisconnectMutation }) {
  const { t } = useI18n(i18n);
  if (!disconnectM.isError || !disconnectM.variables) return null;

  return (
    <div
      className="rounded-xl border border-red-300/50 bg-red-50 px-3.5 py-3 text-[13px] text-red-700 dark:bg-red-400/10 dark:text-red-300"
      role="alert"
    >
      {t("disconnectFailed", {
        source: donationSourceDetails(disconnectM.variables.source).name,
      })}
    </div>
  );
}

function OAuthIntegrationCards({
  authUrlQ,
  disconnectM,
  userInfo,
}: {
  authUrlQ: AuthUrlQuery;
  disconnectM: DisconnectMutation;
  userInfo: ReturnType<typeof useUserInfoSafe>;
}) {
  const { t } = useI18n(i18n);
  const streamElementsStatus: DonationSourceConnectionStatus | null =
    userInfo?.streamElementsConnectionStatus ?? null;
  const streamElementsIssue =
    streamElementsStatus === "reauthorization_required"
      ? t("authorizationExpired")
      : streamElementsStatus === "error"
        ? t("synchronizationStopped")
        : undefined;

  return (
    <>
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
      <DonationIntegrationCard
        authUrl={authUrlQ.data?.streamElements}
        authUrlQ={authUrlQ}
        connectionIssue={streamElementsIssue}
        connected={userInfo?.hasStreamElementsConnection ?? false}
        disconnectM={disconnectM}
        source="streamelements"
      />
    </>
  );
}

function RouteComponent() {
  const userInfo = useUserInfoSafe();
  const authUrlQ = useAuthUrlQ();
  const [widgetFormSource, setWidgetFormSource] = useState<WidgetDonationSource | null>(null);
  const disconnectM = useDisconnectM();
  const { t } = useI18n(i18n);

  return (
    <section className="cosmic-panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <CosmicPageHeader title={t("integrations")} variant="beans" />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-3 sm:p-4">
        <ConnectionNotice />
        <DisconnectError disconnectM={disconnectM} />
        <div className="grid shrink-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <OAuthIntegrationCards
            authUrlQ={authUrlQ}
            disconnectM={disconnectM}
            userInfo={userInfo}
          />
          <WidgetIntegrationCard
            connected={userInfo?.hasDonateStreamConnection ?? false}
            disconnectM={disconnectM}
            onConnect={() => setWidgetFormSource("donate_stream")}
            source="donate_stream"
          />
          <WidgetIntegrationCard
            connected={userInfo?.hasTourniquetConnection ?? false}
            disconnectM={disconnectM}
            onConnect={() => setWidgetFormSource("tourniquet")}
            source="tourniquet"
          />
        </div>
      </div>
      {widgetFormSource === "donate_stream" && (
        <DonateStreamConnectionForm onClose={() => setWidgetFormSource(null)} />
      )}
      {widgetFormSource === "tourniquet" && (
        <TourniquetConnectionForm onClose={() => setWidgetFormSource(null)} />
      )}
    </section>
  );
}
