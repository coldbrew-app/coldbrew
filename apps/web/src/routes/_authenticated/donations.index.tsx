import { createFileRoute } from "@tanstack/react-router";
import DonationCard from "@web/components/donation-card";
import { EmptyState } from "@web/components/empty-state";
import { Icons } from "@web/components/icons";
import { DonationListSkeleton } from "@web/components/loading-skeletons";
import { PagePagination } from "@web/components/page-pagination";
import QueryErrorState from "@web/components/query-error-state";
import { Input } from "@web/components/ui/input";
import { preloadRouteQuery } from "@web/lib/trpc";
import { useEffect, useState } from "react";
import { z } from "zod";

import { useDonationPageQ } from "../../hooks/api";
import { useI18n } from "../../lib/i18n";

const DonationPeriodSchema = z.enum(["all", "week", "month"]);

export const Route = createFileRoute("/_authenticated/donations/")({
  component: DonationsIndex,
  validateSearch: z.object({
    page: z.coerce.number().int().positive().catch(1).default(1),
    period: DonationPeriodSchema.catch("all").default("all"),
    query: z.string().max(200).catch("").default(""),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    if (!context.viewer) {
      return;
    }
    await preloadRouteQuery(context.queryClient, context.trpc.donationPage.queryOptions(deps));
  },
});

function DonationsIndex() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const donationsQ = useDonationPageQ(search);
  const { t } = useI18n();
  const [query, setQuery] = useState(search.query);

  useEffect(() => setQuery(search.query), [search.query]);
  useEffect(() => {
    const timeout = setTimeout(() => {
      const normalizedQuery = query.trim();
      if (normalizedQuery === search.query) {
        return;
      }
      void navigate({
        replace: true,
        search: (previous) => ({ ...previous, page: 1, query: normalizedQuery }),
      });
    }, 300);
    return () => clearTimeout(timeout);
  }, [navigate, query, search.query]);

  useEffect(() => {
    if (donationsQ.data && !donationsQ.isPlaceholderData && donationsQ.data.page !== search.page) {
      void navigate({
        replace: true,
        search: (previous) => ({ ...previous, page: donationsQ.data.page }),
      });
    }
  }, [donationsQ.data, donationsQ.isPlaceholderData, navigate, search.page]);

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
          <Input
            className="h-9 bg-background/60 pr-3 pl-9 text-xs md:text-xs"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("searchBySupporter")}
            value={query}
          />
        </label>
        <label className="relative w-full sm:w-auto">
          <span className="sr-only">{t("dateRange")}</span>
          <select
            className="h-9 w-full appearance-none rounded-lg border border-input bg-background/60 py-0 pr-8 pl-3 text-xs font-semibold text-foreground outline-none focus:border-ring sm:w-36"
            onChange={(event) =>
              void navigate({
                search: (previous) => ({
                  ...previous,
                  page: 1,
                  period: DonationPeriodSchema.parse(event.target.value),
                }),
              })
            }
            value={search.period}
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
      ) : donationsQ.data?.items.length ? (
        <>
          <div className="divide-y divide-border">
            {donationsQ.data.items.map((donation) => (
              <DonationCard key={donation.donationId} donation={donation} />
            ))}
          </div>
          <PagePagination
            isLoading={donationsQ.isFetching}
            loadingLabel={t("loadingDonations")}
            onPageChange={(page) =>
              void navigate({ search: (previous) => ({ ...previous, page }) })
            }
            page={donationsQ.data.page}
            pageSize={donationsQ.data.pageSize}
            total={donationsQ.data.total}
            totalPages={donationsQ.data.totalPages}
          />
        </>
      ) : (
        <EmptyDonations query={search.query} />
      )}
    </>
  );
}

function EmptyDonations({ query }: { query: string }) {
  const { t } = useI18n();
  return (
    <EmptyState
      description={query ? t("tryAnotherSearch") : t("donationsWillAppear")}
      headingLevel={3}
      icon={Icons.wallet}
      title={t(query ? "noMatchingDonations" : "noDonationsYet")}
    />
  );
}
