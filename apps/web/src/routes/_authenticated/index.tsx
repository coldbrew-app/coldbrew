import { createFileRoute, Link } from "@tanstack/react-router";
import { CosmicArt } from "@web/components/cosmic-art";
import { Metric } from "@web/components/dashboard/metric";
import {
  DONATION_ALERTS_NAME,
  DonationAlertsConnectionStatus,
  DonationAlertsMark,
} from "@web/components/donation-alerts";
import DonationCard from "@web/components/donation-card";
import { Icons } from "@web/components/icons";
import { DashboardSkeleton } from "@web/components/loading-skeletons";
import MockChart from "@web/components/mock-chart";
import QueryErrorState from "@web/components/query-error-state";
import { Button } from "@web/components/ui/button";
import { fmtRubles } from "@web/lib/fmt";
import { createTranslator, useI18n } from "@web/lib/i18n";
import { preloadRouteQuery } from "@web/lib/trpc";
import { z } from "zod";

import { useAuthUrlQ, useDonationOverviewQ, useUserInfoSafe } from "../../hooks/api";

export const Route = createFileRoute("/_authenticated/")({
  component: Overview,
  head: ({ match }) => ({
    meta: [
      {
        title: `${createTranslator(match.context.locale)(
          match.context.viewer ? "overview" : "landingPageTitle",
        )} · Coldbrew`,
      },
    ],
  }),
  loader: async ({ context }) => {
    if (!context.viewer) {
      return;
    }
    await Promise.all([
      preloadRouteQuery(context.queryClient, context.trpc.donationOverview.queryOptions()),
      preloadRouteQuery(context.queryClient, context.trpc.authUrls.queryOptions()),
    ]);
  },
  validateSearch: z.object({
    success: z.boolean().optional(),
  }),
});

const panel = "cosmic-panel overflow-hidden";

function Overview() {
  const userInfo = useUserInfoSafe();
  const authUrlQ = useAuthUrlQ();
  const donationOverviewQ = useDonationOverviewQ();
  const success = Route.useSearch({ select: (search) => search.success });
  const donationAlertsConnected = userInfo !== null && userInfo.hasDonationAlertsConnection;
  const { locale, t } = useI18n();

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
    <section className="flex min-w-0 flex-1 flex-col gap-4" id="top">
      <div className="flex w-full flex-col gap-4">
        <header className="cosmic-hero relative grid min-h-[250px] overflow-hidden rounded-3xl p-6 text-white shadow-xl shadow-primary/15 sm:grid-cols-[1fr_280px] sm:p-8">
          <div className="relative z-10 flex max-w-xl flex-col items-start justify-center gap-4">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[10px] font-bold tracking-[0.16em] text-[#ffdd82] uppercase backdrop-blur-sm">
              <span className="size-1.5 rounded-full bg-[#54cfa5] shadow-[0_0_12px_#54cfa5]" />
              {t("brewStatus")}
            </span>
            <div className="flex flex-col gap-2">
              <h1 className="font-heading text-[clamp(34px,5vw,56px)] leading-[0.98] font-semibold tracking-[-0.035em]">
                {t("greeting", { name: "Nikita" })}
              </h1>
              <p className="max-w-md text-sm leading-relaxed text-white/70">{t("streamUpdate")}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                className="h-auto border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/20"
                type="button"
                variant="outline"
              >
                {t("last30Days")} <Icons.dateRange aria-hidden="true" size={16} />
              </Button>
              <span className="text-xs font-semibold text-white/60">{t("orbitCaption")}</span>
            </div>
          </div>
          <CosmicArt className="pointer-events-none absolute right-[-36px] bottom-[-20px] w-[230px] sm:right-[-8px] sm:bottom-[-18px] sm:w-[330px]" />
          <div className="cosmic-grid pointer-events-none absolute inset-0 opacity-[0.16]" />
        </header>
        <div className="sr-only">
          <Icons.greetingAccent aria-hidden="true" />
        </div>
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
                note="↗ 18.2%"
                subnote={t("versusPreviousPeriod")}
                icon={Icons.wallet}
                iconClass="bg-[#ffbd3e]/20 text-[#a65b00] dark:text-[#ffcf69]"
              />
              <Metric
                title={t("donations")}
                value={String(donationsLength)}
                note="↗ 12.5%"
                subnote={t("versusPreviousPeriod")}
                icon={Icons.donations}
                iconClass="bg-[#ff647c]/15 text-[#d83d63] dark:text-[#ff8da0]"
              />
              <Metric
                title={t("averageDonation")}
                value={fmtRubles(donationsLength ? Math.round(total / donationsLength) : 0, locale)}
                note={t("acrossPlatforms")}
                icon={Icons.platform}
                iconClass="bg-[#54cfa5]/18 text-[#188965] dark:text-[#67dfb8]"
              />
            </section>
            <section className="grid gap-4 xl:grid-cols-[1.03fr_.97fr]">
              <article className={panel} id="donations">
                <div className="flex items-start justify-between p-5">
                  <div>
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
                    <p className="mt-1.5 text-xs text-muted-foreground">{t("earningsOverTime")}</p>
                  </div>
                  <Button
                    className="h-auto rounded-md bg-card px-2 py-1.5 text-[11px] font-semibold"
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {t("revenue")} <Icons.chevronRight aria-hidden="true" size={15} />
                  </Button>
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
                className={`${panel} flex min-h-[120px] flex-wrap items-center gap-3 p-5`}
                id="integrations"
              >
                <DonationAlertsMark />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-[13px] font-semibold text-card-foreground">
                      {DONATION_ALERTS_NAME}
                    </h2>
                    <DonationAlertsConnectionStatus connected={donationAlertsConnected} />
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {donationAlertsConnected ? t("automaticSync") : t("connectAllDonations")}
                  </p>
                </div>
                {authUrlQ.data ? (
                  <a
                    className="ml-auto flex items-center gap-1 rounded-lg border border-border px-2.5 py-2 text-[11px] font-bold text-foreground transition hover:bg-muted"
                    href={authUrlQ.data.donationAlerts}
                  >
                    {t("manage")} <Icons.chevronRight aria-hidden="true" size={16} />
                  </a>
                ) : (
                  <Button
                    className="ml-auto h-auto px-2.5 py-2 text-[11px] font-bold"
                    disabled={authUrlQ.isLoading}
                    onClick={() => void authUrlQ.refetch()}
                    size="sm"
                    type="button"
                    variant="outline"
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
              <article className="relative flex min-h-[120px] flex-wrap items-center gap-3 overflow-hidden rounded-3xl bg-linear-to-r from-[#4056e8] via-[#6756dc] to-[#ff647c] p-5 text-white shadow-lg shadow-primary/15">
                <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/15">
                  <Icons.copy aria-hidden="true" />
                </div>
                <div>
                  <h2 className="font-heading text-base font-semibold">{t("readyForOverlay")}</h2>
                  <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-white/75">
                    {t("overlayDescription")}
                  </p>
                </div>
                <Button
                  className="z-10 ml-auto h-auto bg-white px-2.5 py-2 text-[11px] font-bold text-[#293bba] hover:bg-white/90"
                  type="button"
                >
                  {t("createOverlay")} <Icons.chevronRight aria-hidden="true" size={17} />
                </Button>
                <CosmicArt
                  className="pointer-events-none absolute -right-4 -bottom-9 w-40 text-white/30 opacity-35"
                  variant="orbit"
                />
              </article>
            </section>
          </>
        )}
      </div>
    </section>
  );
}
