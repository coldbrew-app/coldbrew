import { createFileRoute } from "@tanstack/react-router";
import { CosmicArt } from "@web/components/cosmic-art";
import DonationCard from "@web/components/donation-card";
import { Icons } from "@web/components/icons";
import { DonationListSkeleton } from "@web/components/loading-skeletons";
import QueryErrorState from "@web/components/query-error-state";
import { preloadRouteQuery } from "@web/lib/trpc";
import { useMemo, useState } from "react";

import { useDonationsQ } from "../../hooks/api";
import { useI18n } from "../../lib/i18n";

export const Route = createFileRoute("/_authenticated/donations/")({
  component: DonationsIndex,
  loader: async ({ context }) => {
    if (!context.viewer) return;
    await preloadRouteQuery(context.queryClient, context.trpc.donations.queryOptions());
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
        .filter((donation) => donation.occurredAt.getTime() >= periodStart)
        .filter((donation) => {
          const searchText = `${donation.author ?? t("anonymous")} ${donation.message ?? ""}`;
          return searchText.toLowerCase().includes(query.trim().toLowerCase());
        })
        .sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime()),
    [donations, periodStart, query, t],
  );

  return (
    <>
      <div className="flex flex-col gap-2 border-b border-border p-4 sm:flex-row sm:p-5">
        <label className="relative min-w-0 grow">
          <Icons.search
            aria-hidden="true"
            size={16}
            className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
          />
          <span className="sr-only">{t("searchDonations")}</span>
          <input
            className="h-9 w-full rounded-lg border border-input bg-background/60 pr-3 pl-9 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-3 focus:ring-ring/20"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("searchBySupporter")}
            value={query}
          />
        </label>
        <label className="relative w-full sm:w-auto">
          <span className="sr-only">{t("dateRange")}</span>
          <select
            className="h-9 w-full appearance-none rounded-lg border border-input bg-background/60 py-0 pr-8 pl-3 text-xs font-semibold text-foreground outline-none focus:border-ring sm:w-36"
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
            className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground"
          />
        </label>
      </div>

      {donationsQ.isLoading ? (
        <DonationListSkeleton aria-busy="true" aria-label={t("loadingDonations")} />
      ) : donationsQ.isError ? (
        <QueryErrorState
          isRetrying={donationsQ.isFetching}
          onRetry={() => void donationsQ.refetch()}
        />
      ) : filteredDonations.length ? (
        <div className="divide-y divide-border">
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
      <div className="relative flex flex-col items-center gap-2 overflow-hidden">
        <CosmicArt
          className="absolute -top-10 -right-24 w-40 text-primary/20 opacity-25"
          variant="orbit"
        />
        <div className="mx-auto grid size-11 place-items-center rounded-xl bg-secondary text-secondary-foreground">
          <Icons.wallet aria-hidden="true" size={20} />
        </div>
        <h3 className="mt-4 text-sm font-semibold text-card-foreground">
          {t(query ? "noMatchingDonations" : "noDonationsYet")}
        </h3>
        <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-muted-foreground">
          {query ? t("tryAnotherSearch") : t("donationsWillAppear")}
        </p>
      </div>
    </div>
  );
}
