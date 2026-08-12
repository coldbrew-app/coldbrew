import { Metric } from "@client/components/dashboard/metric";
import DonationCard from "@client/components/donation-card";
import MockChart from "@client/components/mock-chart";
import { Button } from "@client/components/ui/button";
import { fmtAmount, fmtDate } from "@client/lib/fmt";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, Copy, Share2, Sparkles, Wallet } from "lucide-react";
import { z } from "zod";

import { useAuthUrl, useDonationsQ as useDonations, useUserInfo } from "../hooks/api";

export const Route = createFileRoute("/")({
  component: Overview,
  validateSearch: z.object({ success: z.boolean().optional() }),
});

const panel = "rounded-xl border border-[#eae8ef] bg-white";

function Overview() {
  const userInfo = useUserInfo();
  const authUrl = useAuthUrl();
  const donationsQ = useDonations();
  const success = Route.useSearch({ select: (search) => search.success });
  const donationAlertsConnected = userInfo !== null && userInfo.hasDonationalertsAccessToken;

  const total = donationsQ.data?.reduce((sum, donation) => sum + donation.amount, 0) ?? 0;
  const donationsLength = donationsQ.data?.length ?? 0;

  return (
    <section className="flex min-w-0 flex-1 flex-col" id="top">
      <div className="mx-auto w-full max-w-7xl px-[clamp(18px,4vw,62px)] py-7 sm:py-12">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="mb-2.5 text-xs font-bold tracking-wide text-[#9895a6] uppercase">
              Monday, 28 July
            </p>
            <h1 className="text-[clamp(27px,3vw,33px)] font-bold tracking-tight text-[#27243a]">
              Good evening, Nikita <span className="text-violet-500">✦</span>
            </h1>
            <p className="mt-2.5 text-sm text-[#888597]">
              Here’s what’s happening across your stream.
            </p>
          </div>
          <Button
            className="h-auto w-full justify-between border-[#e3e1e9] bg-white px-3 py-2.5 text-xs font-semibold text-[#646176] sm:w-auto"
            type="button"
            variant="outline"
          >
            Last 30 days <ChevronRight aria-hidden="true" size={16} />
          </Button>
        </div>
        {success !== undefined && (
          <div
            className={`mt-5 rounded-lg px-3.5 py-3 text-[13px] ${success ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}
          >
            {success
              ? "Donation Alerts connected successfully."
              : "We couldn't finish connecting your account."}
          </div>
        )}
        <section className="mt-7 grid gap-4 sm:mt-9 md:grid-cols-3" aria-label="Stream statistics">
          <Metric
            title="Total received"
            value={fmtAmount(total)}
            note="↗ 18.2%"
            subnote="vs. previous period"
            icon={Wallet}
            iconClass="bg-violet-100 text-violet-600"
          />
          <Metric
            title="Donations"
            value={String(donationsLength)}
            note="↗ 12.5%"
            subnote="vs. previous period"
            icon={Sparkles}
            iconClass="bg-orange-50 text-orange-500"
          />
          <Metric
            title="Average donation"
            value={fmtAmount(Math.round(total / donationsLength))}
            note="Across all connected platforms"
            icon={Share2}
            iconClass="bg-sky-50 text-sky-500"
          />
        </section>
        <section className="mt-4 grid gap-4 xl:grid-cols-[1.03fr_.97fr]">
          <article className={panel} id="donations">
            <div className="flex items-start justify-between p-5">
              <div>
                <h2 className="text-[15px] font-semibold text-[#353248]">Recent activity</h2>
                <p className="mt-1.5 text-xs text-[#9491a1]">Every donation, all in one place.</p>
              </div>
              <Link to="/donations" className="flex items-center text-xs font-bold text-violet-600">
                View all <ChevronRight aria-hidden="true" size={16} />
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
                <h2 className="text-[15px] font-semibold text-[#353248]">Donation trends</h2>
                <p className="mt-1.5 text-xs text-[#9491a1]">Your earnings over time.</p>
              </div>
              <Button
                className="h-auto rounded-md border-[#e3e1e9] bg-white px-2 py-1.5 text-[11px] font-semibold text-[#646176]"
                size="sm"
                type="button"
                variant="outline"
              >
                Revenue <ChevronRight aria-hidden="true" size={15} />
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
                <span>Jun 29</span>
                <span>Jul 6</span>
                <span>Jul 13</span>
                <span>Jul 20</span>
                <span>Jul 27</span>
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
                  {donationAlertsConnected ? "Connected" : "Setup needed"}
                </span>
              </div>
              <p className="mt-1.5 text-xs text-[#9491a1]">
                {donationAlertsConnected
                  ? "Donations are syncing automatically."
                  : "Connect to bring all your donations here."}
              </p>
            </div>
            <a
              className="ml-auto flex items-center gap-1 rounded-lg border border-[#e4e2e9] px-2.5 py-2 text-[11px] font-bold text-[#5f5b70]"
              href={authUrl.donationAlerts}
            >
              Manage <ChevronRight aria-hidden="true" size={16} />
            </a>
          </article>
          <article className="relative flex min-h-[120px] flex-wrap items-center gap-3 overflow-hidden rounded-xl bg-linear-to-r from-violet-700 to-violet-400 p-5 text-white">
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/15">
              <Copy aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-[13px] font-semibold">Ready for your overlay?</h2>
              <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-violet-100">
                Bring your donations to life on stream with a custom browser source.
              </p>
            </div>
            <Button
              className="z-10 ml-auto h-auto bg-white px-2.5 py-2 text-[11px] font-bold text-violet-700 hover:bg-white/90 dark:text-white"
              type="button"
            >
              Create overlay <ChevronRight aria-hidden="true" size={17} />
            </Button>
            <span className="absolute -top-16 -right-16 size-[148px] rounded-full border border-white/15" />
          </article>
        </section>
      </div>
    </section>
  );
}
