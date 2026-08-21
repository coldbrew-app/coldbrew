import { createFileRoute } from "@tanstack/react-router";
import DonationCard from "@web/components/donation-card";
import { Icons } from "@web/components/icons";
import { DonationListSkeleton } from "@web/components/loading-skeletons";
import { useMemo, useState } from "react";

import { useDonationsQ } from "../../hooks/api";
import { useI18n } from "../../lib/i18n";

export const Route = createFileRoute("/_authenticated/donations/")({
  component: DonationsIndex,
  loader: async ({ context }) => {
    if (!context.viewer) return;
    await context.queryClient.ensureQueryData(context.trpc.donations.queryOptions());
  },
});

function DonationsIndex() {
  const donationsQ = useDonationsQ();
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState<"all" | "week" | "month">("all");
  const donations = donationsQ.data ?? [];
  const now = Date.now();
  const periodStart =
    period === "week"
      ? now - 7 * 24 * 60 * 60 * 1000
      : period === "month"
        ? now - 30 * 24 * 60 * 60 * 1000
        : 0;
  const filteredDonations = useMemo(
    () =>
      donations
        .filter((donation) => donation.createdAt.getTime() >= periodStart)
        .filter((donation) => {
          const searchText = `${donation.author ?? t("anonymous")} ${donation.message ?? ""}`;
          return searchText.toLowerCase().includes(query.trim().toLowerCase());
        })
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime()),
    [donations, periodStart, query, t],
  );

  return (
    <>
      <div className="flex flex-col gap-2 border-b border-[#efedf3] p-4 sm:flex-row sm:p-5">
        <label className="relative min-w-0 grow">
          <Icons.search
            aria-hidden="true"
            size={16}
            className="absolute top-1/2 left-3 -translate-y-1/2 text-[#a19eae]"
          />
          <span className="sr-only">{t("searchDonations")}</span>
          <input
            className="h-9 w-full rounded-lg border border-[#e5e3ea] bg-[#fcfcfd] pr-3 pl-9 text-xs text-[#4a465b] outline-none placeholder:text-[#aaa7b5] focus:border-violet-400 focus:ring-3 focus:ring-violet-100"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("searchBySupporter")}
            value={query}
          />
        </label>
        <label className="relative w-full sm:w-auto">
          <span className="sr-only">{t("dateRange")}</span>
          <select
            className="h-9 w-full appearance-none rounded-lg border border-[#e5e3ea] bg-white py-0 pr-8 pl-3 text-xs font-semibold text-[#605c70] outline-none focus:border-violet-400 sm:w-36"
            onChange={(event) => setPeriod(event.target.value as typeof period)}
            value={period}
          >
            <option value="all">{t("allTime")}</option>
            <option value="week">{t("last7Days")}</option>
            <option value="month">{t("last30Days")}</option>
          </select>
          <Icons.chevronDown
            aria-hidden="true"
            size={15}
            className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-[#898596]"
          />
        </label>
      </div>

      {donationsQ.isLoading ? (
        <DonationListSkeleton aria-busy="true" aria-label={t("loadingDonations")} />
      ) : filteredDonations.length ? (
        <div className="divide-y divide-[#f0eff3]">
          {filteredDonations.map((donation) => (
            <DonationCard key={donation.donationId} donation={donation} />
          ))}
        </div>
      ) : (
        <EmptyDonations query={query} />
      )}
    </>
  );
}

function EmptyDonations({ query }: { query: string }) {
  const { t } = useI18n();
  return (
    <div className="grid min-h-64 place-items-center px-5 text-center">
      <div>
        <div className="mx-auto grid size-11 place-items-center rounded-xl bg-violet-100 text-violet-600">
          <Icons.wallet aria-hidden="true" size={20} />
        </div>
        <h3 className="mt-4 text-sm font-semibold text-[#4c485b]">
          {t(query ? "noMatchingDonations" : "noDonationsYet")}
        </h3>
        <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-[#908d9d]">
          {query ? t("tryAnotherSearch") : t("donationsWillAppear")}
        </p>
      </div>
    </div>
  );
}
