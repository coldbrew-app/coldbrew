import { createFileRoute, Link } from "@tanstack/react-router";
import { Metric } from "@web/components/dashboard/metric";
import DonationCard from "@web/components/donation-card";
import { Icons } from "@web/components/icons";
import { DashboardSkeleton } from "@web/components/loading-skeletons";
import MockChart from "@web/components/mock-chart";
import { Button } from "@web/components/ui/button";
import { fmtAmount } from "@web/lib/fmt";
import { createTranslator, useI18n } from "@web/lib/i18n";
import { z } from "zod";

import { useAuthUrl, useDonationsQ as useDonations, useUserInfo } from "../../hooks/api";

export const Route = createFileRoute("/_authenticated/")({
  component: Overview,
  head: ({ match }) => ({
    meta: [{ title: `${createTranslator(match.context.locale)("overview")} · Coldbrew` }],
  }),
  loader: async ({ context }) => {
    if (!context.viewer) return;
    await context.queryClient.ensureQueryData(context.trpc.donations.queryOptions());
  },
  validateSearch: z.object({ success: z.boolean().optional() }),
});

const panel = "rounded-xl border border-[#eae8ef] bg-white";

function Overview() {
  const userInfo = useUserInfo();
  const authUrl = useAuthUrl();
  const donationsQ = useDonations();
  const success = Route.useSearch({ select: (search) => search.success });
  const donationAlertsConnected = userInfo !== null && userInfo.hasDonationalertsAccessToken;
  const { locale, t } = useI18n();

  const total = donationsQ.data?.reduce((sum, donation) => sum + donation.amount, 0) ?? 0;
  const donationsLength = donationsQ.data?.length ?? 0;
  const chartDates = ["2026-06-29", "2026-07-06", "2026-07-13", "2026-07-20", "2026-07-27"].map(
    (date) =>
      new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
        day: "numeric",
        month: "short",
      }).format(new Date(`${date}T00:00:00`)),
  );

  return (
    <section className="flex min-w-0 flex-1 flex-col" id="top">
      <div className="w-full">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-[clamp(27px,3vw,33px)] font-bold tracking-tight text-[#27243a]">
              {t("greeting", { name: "Nikita" })} <span className="text-violet-500">✦</span>
            </h1>
            <p className="mt-2.5 text-sm text-[#888597]">{t("streamUpdate")}</p>
          </div>
          <Button
            className="h-auto w-full justify-between border-[#e3e1e9] bg-white px-3 py-2.5 text-xs font-semibold text-[#646176] sm:w-auto"
            type="button"
            variant="outline"
          >
            {t("last30Days")} <Icons.dateRange aria-hidden="true" size={16} />
          </Button>
        </div>
        {success !== undefined && (
          <div
            className={`mt-5 rounded-lg px-3.5 py-3 text-[13px] ${success ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}
          >
            {success ? t("connected") : t("notConnected")}
          </div>
        )}
        {donationsQ.isLoading ? (
          <DashboardSkeleton aria-busy="true" aria-label={t("loadingDonations")} />
        ) : (
          <>
            <section
              className="mt-7 grid gap-4 sm:mt-9 md:grid-cols-3"
              aria-label={t("streamStatistics")}
            >
              <Metric
                title={t("totalReceived")}
                value={fmtAmount(total, locale)}
                note="↗ 18.2%"
                subnote={t("versusPreviousPeriod")}
                icon={Icons.wallet}
                iconClass="bg-violet-100 text-violet-600"
              />
              <Metric
                title={t("donations")}
                value={String(donationsLength)}
                note="↗ 12.5%"
                subnote={t("versusPreviousPeriod")}
                icon={Icons.donations}
                iconClass="bg-orange-50 text-orange-500"
              />
              <Metric
                title={t("averageDonation")}
                value={fmtAmount(Math.round(total / donationsLength), locale)}
                note={t("acrossPlatforms")}
                icon={Icons.platform}
                iconClass="bg-sky-50 text-sky-500"
              />
            </section>
            <section className="mt-4 grid gap-4 xl:grid-cols-[1.03fr_.97fr]">
              <article className={panel} id="donations">
                <div className="flex items-start justify-between p-5">
                  <div>
                    <h2 className="text-[15px] font-semibold text-[#353248]">
                      {t("recentActivity")}
                    </h2>
                    <p className="mt-1.5 text-xs text-[#9491a1]">{t("everyDonation")}</p>
                  </div>
                  <Link
                    to="/donations"
                    className="flex items-center text-xs font-bold text-violet-600"
                  >
                    {t("viewAll")} <Icons.chevronRight aria-hidden="true" size={16} />
                  </Link>
                </div>
                <div>
                  {donationsQ.data?.slice(0, 3).map((donation, index) => (
                    <DonationCard
                      key={`${donation.author}-${index}`}
                      className="border-t border-[#f0eff3]"
                      donation={donation}
                    />
                  ))}
                </div>
              </article>
              <article className={`${panel} min-h-[290px] overflow-hidden`}>
                <div className="flex items-start justify-between p-5 pb-1">
                  <div>
                    <h2 className="text-[15px] font-semibold text-[#353248]">
                      {t("donationTrends")}
                    </h2>
                    <p className="mt-1.5 text-xs text-[#9491a1]">{t("earningsOverTime")}</p>
                  </div>
                  <Button
                    className="h-auto rounded-md border-[#e3e1e9] bg-white px-2 py-1.5 text-[11px] font-semibold text-[#646176]"
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {t("revenue")} <Icons.chevronRight aria-hidden="true" size={15} />
                  </Button>
                </div>
                <div className="relative h-52 px-4 pt-3 pb-2 pl-10">
                  <div className="absolute bottom-9 left-2 flex h-[164px] flex-col justify-between text-[10px] text-[#aaa6b5]">
                    <span>6k</span>
                    <span>4k</span>
                    <span>2k</span>
                    <span>0</span>
                  </div>
                  <MockChart className="h-[164px] w-full" />
                  <div className="flex justify-between text-[10px] text-[#aaa6b5]">
                    {chartDates.map((date) => (
                      <span key={date}>{date}</span>
                    ))}
                  </div>
                </div>
              </article>
            </section>
            <section className="mt-4 grid gap-4 xl:grid-cols-2">
              <article
                className={`${panel} flex min-h-[120px] flex-wrap items-center gap-3 p-5`}
                id="integrations"
              >
                <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-linear-to-br from-orange-400 to-rose-500 text-[11px] font-bold text-white">
                  DA
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-[13px] font-semibold text-[#403c52]">DonationAlerts</h2>
                    <span
                      className={`flex items-center gap-1 text-[10px] font-bold ${donationAlertsConnected ? "text-emerald-600" : "text-orange-500"}`}
                    >
                      <i className="size-1.5 rounded-full bg-current" />
                      {t(donationAlertsConnected ? "connected" : "setupNeeded")}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-[#9491a1]">
                    {donationAlertsConnected ? t("automaticSync") : t("connectAllDonations")}
                  </p>
                </div>
                <a
                  className="ml-auto flex items-center gap-1 rounded-lg border border-[#e4e2e9] px-2.5 py-2 text-[11px] font-bold text-[#5f5b70]"
                  href={authUrl.donationAlerts}
                >
                  {t("manage")} <Icons.chevronRight aria-hidden="true" size={16} />
                </a>
              </article>
              <article className="relative flex min-h-[120px] flex-wrap items-center gap-3 overflow-hidden rounded-xl bg-linear-to-r from-violet-700 to-violet-400 p-5 text-white">
                <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/15">
                  <Icons.copy aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-[13px] font-semibold">{t("readyForOverlay")}</h2>
                  <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-violet-100">
                    {t("overlayDescription")}
                  </p>
                </div>
                <Button
                  className="z-10 ml-auto h-auto bg-white px-2.5 py-2 text-[11px] font-bold text-violet-700 hover:bg-white/90 dark:text-white"
                  type="button"
                >
                  {t("createOverlay")} <Icons.chevronRight aria-hidden="true" size={17} />
                </Button>
                <span className="absolute -top-16 -right-16 size-[148px] rounded-full border border-white/15" />
              </article>
            </section>
          </>
        )}
      </div>
    </section>
  );
}
