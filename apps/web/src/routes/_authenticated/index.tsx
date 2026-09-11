import { createFileRoute, Link } from "@tanstack/react-router";
import { CosmicArt } from "@web/components/cosmic-art";
import { CosmicPageHeader } from "@web/components/cosmic-page-header";
import { Metric } from "@web/components/dashboard/metric";
import {
  DONATE_STREAM_NAME,
  DonateStreamConnectionStatus,
  DonateStreamMark,
} from "@web/components/donate-stream";
import {
  DonationAlertsConnectionStatus,
  DonationAlertsMark,
  DonationAlertsNameLink,
} from "@web/components/donation-alerts";
import DonationCard from "@web/components/donation-card";
import { Icons } from "@web/components/icons";
import { DashboardSkeleton } from "@web/components/loading-skeletons";
import MockChart from "@web/components/mock-chart";
import QueryErrorState from "@web/components/query-error-state";
import {
  StreamlabsConnectionStatus,
  StreamlabsMark,
  StreamlabsNameLink,
} from "@web/components/streamlabs";
import { buttonVariants } from "@web/components/ui/button";
import { fmtRubles } from "@web/lib/fmt";
import { createI18n, createTranslator, useI18n } from "@web/lib/i18n";
import { preloadRouteQuery } from "@web/lib/trpc";
import { cn } from "@web/lib/utils";
import { z } from "zod";

import { useDonationOverviewQ, useUserInfoSafe } from "../../hooks/api";

const i18n = createI18n({
  overview: {
    en: "Overview",
    ru: "Главная",
  },
  donations: {
    en: "Donations",
    ru: "Донаты",
  },
  streamStatistics: {
    en: "Stream stats",
    ru: "Статистика стрима",
  },
  totalReceived: {
    en: "Total received",
    ru: "Всего получено",
  },
  averageDonation: {
    en: "Average donation",
    ru: "Средний донат",
  },
  acrossPlatforms: {
    en: "Across connected platforms",
    ru: "По всем подключённым платформам",
  },
  recentActivity: {
    en: "Recent activity",
    ru: "Последние донаты",
  },
  everyDonation: {
    en: "All your donations, in one place.",
    ru: "Свежие донаты со всех подключённых платформ.",
  },
  viewAll: {
    en: "View all",
    ru: "Посмотреть все",
  },
  donationTrends: {
    en: "Donation trends",
    ru: "Динамика донатов",
  },
  automaticSync: {
    en: "Donations sync automatically.",
    ru: "Новые донаты загружаются автоматически.",
  },
  connectAllDonations: {
    en: "Connect your donation platforms to see everything here.",
    ru: "Подключите платформы, чтобы видеть все донаты здесь.",
  },
  donationSources: {
    en: "Donation sources",
    ru: "Источники донатов",
  },
  manage: {
    en: "Manage",
    ru: "Настроить",
  },
  readyForOverlay: {
    en: "Need an overlay for your stream?",
    ru: "Нужен оверлей для стрима?",
  },
  overlayDescription: {
    en: "Set up a chat overlay for your stream in Multichat.",
    ru: "Настройте чат-оверлей для стрима в разделе «Мультичат».",
  },
  createOverlay: {
    en: "Set up chat overlay",
    ru: "Настроить чат-оверлей",
  },
  landingPageTitle: {
    en: "Donations, video queue, and multichat for streamers",
    ru: "Донаты, очередь видео и мультичат для стримеров",
  },
  connected: {
    en: "Connected",
    ru: "Подключено",
  },
  notConnected: {
    en: "Not connected",
    ru: "Не подключено",
  },
  allTime: {
    en: "All time",
    ru: "За всё время",
  },
  sampleChart: {
    en: "Example",
    ru: "Пример",
  },
  sampleChartDescription: {
    en: "Illustrative chart. These values are not your donation history.",
    ru: "Демонстрационный график. Значения не отражают историю ваших донатов.",
  },
  loadingDonations: {
    en: "Loading donations",
    ru: "Загружаем донаты…",
  },
});

export const Route = createFileRoute("/_authenticated/")({
  component: Overview,
  head: ({ match }) => ({
    meta: [
      {
        title: `${createTranslator(
          match.context.locale,
          i18n,
        )(match.context.viewer ? "overview" : "landingPageTitle")} · Coldbrew`,
      },
    ],
  }),
  loader: async ({ context }) => {
    if (!context.viewer) {
      return;
    }
    await preloadRouteQuery(context.queryClient, context.trpc.donationOverview.queryOptions());
  },
  validateSearch: z.object({
    success: z.boolean().optional(),
  }),
});

const panel = "cosmic-panel overflow-hidden";

function Overview() {
  const userInfo = useUserInfoSafe();
  const donationOverviewQ = useDonationOverviewQ();
  const success = Route.useSearch({ select: (search) => search.success });
  const donationAlertsConnected = userInfo !== null && userInfo.hasDonationAlertsConnection;
  const donateStreamConnected = userInfo !== null && userInfo.hasDonateStreamConnection;
  const streamlabsConnected = userInfo !== null && userInfo.hasStreamlabsConnection;
  const hasDonationConnection =
    donationAlertsConnected || donateStreamConnected || streamlabsConnected;
  const { locale, t } = useI18n(i18n);

  const total = donationOverviewQ.data?.totalAmount ?? 0;
  const donationsLength = donationOverviewQ.data?.donationCount ?? 0;
  const chartDates = ["2026-06-29", "2026-07-06", "2026-07-13", "2026-07-20", "2026-07-27"].map(
    (date) =>
      new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
        day: "numeric",
        month: "short",
      }).format(new Date(`${date}T00:00:00`)),
  );

  return (
    <section className="cosmic-panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden" id="top">
      <CosmicPageHeader title={t("overview")} />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="flex flex-col gap-4 p-4 sm:p-5">
          {success !== undefined && (
            <div
              className={`rounded-xl border px-3.5 py-3 text-[13px] ${success ? "border-emerald-300/50 bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300" : "border-red-300/50 bg-red-50 text-red-700 dark:bg-red-400/10 dark:text-red-300"}`}
            >
              {success ? t("connected") : t("notConnected")}
            </div>
          )}
          {donationOverviewQ.isLoading ? (
            <DashboardSkeleton aria-busy="true" aria-label={t("loadingDonations")} />
          ) : donationOverviewQ.isError ? (
            <QueryErrorState
              className="mt-7 rounded-2xl border border-border bg-card sm:mt-9"
              isRetrying={donationOverviewQ.isFetching}
              onRetry={() => void donationOverviewQ.refetch()}
            />
          ) : (
            <>
              <section className="grid gap-4 md:grid-cols-3" aria-label={t("streamStatistics")}>
                <Metric
                  title={t("totalReceived")}
                  value={fmtRubles(total, locale)}
                  note={t("allTime")}
                  icon={Icons.wallet}
                  iconClass="bg-[#ffbd3e]/20 text-[#a65b00] dark:text-[#ffcf69]"
                />
                <Metric
                  title={t("donations")}
                  value={String(donationsLength)}
                  note={t("allTime")}
                  icon={Icons.donations}
                  iconClass="bg-[#ff647c]/15 text-[#d83d63] dark:text-[#ff8da0]"
                />
                <Metric
                  title={t("averageDonation")}
                  value={fmtRubles(
                    donationsLength ? Math.round(total / donationsLength) : 0,
                    locale,
                  )}
                  note={t("acrossPlatforms")}
                  icon={Icons.platform}
                  iconClass="bg-[#54cfa5]/18 text-[#188965] dark:text-[#67dfb8]"
                />
              </section>
              <section className="grid gap-4 xl:grid-cols-[1.03fr_.97fr]">
                <article className={panel} id="donations">
                  <div className="flex items-start justify-between p-5">
                    <div className="flex flex-col gap-1">
                      <h2 className="font-heading text-lg font-semibold text-card-foreground">
                        {t("recentActivity")}
                      </h2>
                      <p className="mt-1.5 text-xs text-muted-foreground">{t("everyDonation")}</p>
                    </div>
                    <Link
                      to="/donations"
                      className="flex items-center text-xs font-bold text-primary hover:text-primary/75"
                    >
                      {t("viewAll")} <Icons.chevronRight aria-hidden="true" size={16} />
                    </Link>
                  </div>
                  <div>
                    {donationOverviewQ.data?.recentDonations.map((donation) => (
                      <DonationCard
                        key={donation.donationId}
                        className="border-t border-border"
                        donation={donation}
                      />
                    ))}
                  </div>
                </article>
                <article className={`${panel} min-h-[290px] overflow-hidden`}>
                  <div className="flex items-start justify-between p-5 pb-1">
                    <div>
                      <h2 className="font-heading text-lg font-semibold text-card-foreground">
                        {t("donationTrends")}
                      </h2>
                      <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-muted-foreground">
                        {t("sampleChartDescription")}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-md bg-muted px-2 py-1.5 text-[11px] font-medium text-muted-foreground">
                      {t("sampleChart")}
                    </span>
                  </div>
                  <div className="relative h-52 px-4 pt-3 pb-2 pl-10">
                    <div className="absolute bottom-9 left-2 flex h-[164px] flex-col justify-between text-[10px] text-muted-foreground">
                      <span>6k</span>
                      <span>4k</span>
                      <span>2k</span>
                      <span>0</span>
                    </div>
                    <MockChart className="h-[164px] w-full" />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      {chartDates.map((date) => (
                        <span key={date}>{date}</span>
                      ))}
                    </div>
                  </div>
                </article>
              </section>
              <section className="grid gap-4 xl:grid-cols-2">
                <article
                  className={`${panel} flex min-h-[120px] flex-col gap-4 p-5`}
                  id="integrations"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="font-heading text-base font-semibold text-card-foreground">
                        {t("donationSources")}
                      </h2>
                      <p className="text-xs text-muted-foreground">
                        {t(hasDonationConnection ? "automaticSync" : "connectAllDonations")}
                      </p>
                    </div>
                    <Link
                      className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-2 text-[11px] font-bold text-foreground transition hover:bg-muted"
                      to="/integrations"
                    >
                      {t("manage")} <Icons.chevronRight aria-hidden="true" size={16} />
                    </Link>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <div className="flex min-w-0 items-center gap-2 rounded-xl bg-muted/55 p-2.5">
                      <DonationAlertsMark />
                      <span className="truncate text-xs font-semibold text-card-foreground">
                        <DonationAlertsNameLink />
                      </span>
                      <DonationAlertsConnectionStatus connected={donationAlertsConnected} />
                    </div>
                    <div className="flex min-w-0 items-center gap-2 rounded-xl bg-muted/55 p-2.5">
                      <DonateStreamMark />
                      <span className="truncate text-xs font-semibold text-card-foreground">
                        {DONATE_STREAM_NAME}
                      </span>
                      <DonateStreamConnectionStatus connected={donateStreamConnected} />
                    </div>
                    <div className="flex min-w-0 items-center gap-2 rounded-xl bg-muted/55 p-2.5">
                      <StreamlabsMark />
                      <span className="truncate text-xs font-semibold text-card-foreground">
                        <StreamlabsNameLink />
                      </span>
                      <StreamlabsConnectionStatus connected={streamlabsConnected} />
                    </div>
                  </div>
                </article>
                <article className="relative flex min-h-[120px] flex-wrap items-center gap-3 overflow-hidden rounded-2xl bg-[#51405e] p-5 text-[#fff8ed]">
                  <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/15">
                    <Icons.copy aria-hidden="true" />
                  </div>
                  <div>
                    <h2 className="font-heading text-base font-semibold">{t("readyForOverlay")}</h2>
                    <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-white/75">
                      {t("overlayDescription")}
                    </p>
                  </div>
                  <Link
                    className={cn(
                      buttonVariants(),
                      "z-10 ml-auto h-auto bg-white px-2.5 py-2 text-[11px] font-bold text-[#51405e] hover:bg-white/90",
                    )}
                    to="/chat"
                  >
                    {t("createOverlay")} <Icons.chevronRight aria-hidden="true" size={17} />
                  </Link>
                  <CosmicArt
                    className="pointer-events-none absolute -right-4 -bottom-9 w-40 text-white/30 opacity-35"
                    variant="orbit"
                  />
                </article>
              </section>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
