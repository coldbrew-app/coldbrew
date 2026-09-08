import type { ChatDeadLetter } from "@coldbrew/packages/chat.js";
import { Link, createFileRoute } from "@tanstack/react-router";
import { AdminTabs } from "@web/components/admin-tabs";
import { CosmicPageHeader } from "@web/components/cosmic-page-header";
import { EmptyState } from "@web/components/empty-state";
import { Icons } from "@web/components/icons";
import QueryErrorState from "@web/components/query-error-state";
import { Button } from "@web/components/ui/button";
import { Skeleton } from "@web/components/ui/skeleton";
import { useChatDeadLettersQ } from "@web/hooks/api";
import { createTranslator, useI18n } from "@web/lib/i18n";
import { preloadRouteQuery } from "@web/lib/trpc";
import { z } from "zod";

export const Route = createFileRoute("/_authenticated/_admin/admin/dlq")({
  component: DeadLettersPage,
  validateSearch: z.object({
    before: z
      .string()
      .regex(/^[1-9]\d*$/)
      .optional()
      .catch(undefined),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    await preloadRouteQuery(
      context.queryClient,
      context.trpc.chat.deadLetters.queryOptions({ beforeSequence: deps.before }),
    );
  },
  head: ({ match }) => ({
    meta: [{ title: `${createTranslator(match.context.locale)("deadLetters")} · Coldbrew` }],
  }),
});

function DeadLettersPage() {
  const search = Route.useSearch();
  const deadLettersQ = useChatDeadLettersQ(search.before);
  const { t } = useI18n();

  return (
    <section className="cosmic-panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <CosmicPageHeader
        actions={
          deadLettersQ.data ? (
            <span className="rounded-full border border-amber-200/40 bg-amber-950/60 px-2.5 py-1 text-xs font-semibold text-amber-100 tabular-nums">
              {t("deadLetterCount", { count: deadLettersQ.data.total })}
            </span>
          ) : undefined
        }
        description={t("deadLettersDescription")}
        title={t("deadLetters")}
        navigation={<AdminTabs />}
      />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {deadLettersQ.isLoading ? (
          <DeadLettersSkeleton />
        ) : deadLettersQ.isError ? (
          <QueryErrorState
            isRetrying={deadLettersQ.isFetching}
            onRetry={() => void deadLettersQ.refetch()}
          />
        ) : deadLettersQ.data?.items.length ? (
          <div className="divide-y divide-border">
            {deadLettersQ.data.items.map((deadLetter) => (
              <DeadLetterRow deadLetter={deadLetter} key={deadLetter.sequence} />
            ))}
          </div>
        ) : (
          <EmptyState
            description={t("noDeadLettersDescription")}
            headingLevel={2}
            icon={Icons.deadLetter}
            title={t("noDeadLetters")}
          />
        )}
      </div>
      {deadLettersQ.data && deadLettersQ.data.items.length > 0 && (
        <nav
          aria-label={t("deadLetterPagination")}
          className="flex shrink-0 flex-col items-stretch justify-between gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:px-5"
        >
          <span className="text-[11px] text-muted-foreground">
            {t("deadLettersShown", { count: deadLettersQ.data.items.length })}
          </span>
          <div className="flex items-center gap-2">
            {search.before && (
              <Button render={<Link search={{}} to="/admin/dlq" />} size="sm" variant="outline">
                <Icons.chevronLeft aria-hidden="true" />
                {t("newestDeadLetters")}
              </Button>
            )}
            {deadLettersQ.data.nextBeforeSequence && (
              <Button
                render={
                  <Link search={{ before: deadLettersQ.data.nextBeforeSequence }} to="/admin/dlq" />
                }
                size="sm"
                variant="outline"
              >
                {t("olderDeadLetters")}
                <Icons.chevronRight aria-hidden="true" />
              </Button>
            )}
          </div>
        </nav>
      )}
    </section>
  );
}

function DeadLetterRow({ deadLetter }: { deadLetter: ChatDeadLetter }) {
  const { locale, t } = useI18n();
  const payload = decodeBase64(deadLetter.payload);
  const failedAt = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(deadLetter.failedAt);

  return (
    <details className="group px-4 py-4 open:bg-muted/30 sm:px-5">
      <summary className="grid cursor-pointer list-none grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[auto_minmax(0,1fr)_auto] [&::-webkit-details-marker]:hidden">
        <span className="row-span-2 grid size-9 shrink-0 place-items-center rounded-lg bg-destructive/10 text-destructive sm:row-span-1">
          <Icons.deadLetter aria-hidden="true" size={17} />
        </span>
        <span className="flex min-w-0 grow flex-col gap-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <code className="break-all text-xs font-semibold text-foreground">
              {deadLetter.sourceSubject}
            </code>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              #{deadLetter.sequence}
            </span>
          </span>
          <span className="line-clamp-2 text-xs leading-5 text-destructive">
            {deadLetter.error}
          </span>
        </span>
        <span className="col-start-2 flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground tabular-nums sm:col-start-3 sm:row-start-1">
          <time dateTime={deadLetter.failedAt.toISOString()}>{failedAt}</time>
          <Icons.chevronDown
            aria-hidden="true"
            className="transition-transform group-open:rotate-180"
            size={15}
          />
        </span>
      </summary>
      <div className="grid gap-3 pt-4 sm:pl-12">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-semibold text-foreground">{t("deadLetterPayload")}</span>
          {deadLetter.payloadTruncated && (
            <span className="text-[11px] font-medium text-amber-700 dark:text-amber-200">
              {t("deadLetterPayloadTruncated")}
            </span>
          )}
        </div>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-xl border border-border bg-background/70 p-3 font-mono text-xs leading-5 text-foreground">
          {payload}
        </pre>
      </div>
    </details>
  );
}

function DeadLettersSkeleton() {
  return (
    <div aria-busy="true" className="divide-y divide-border">
      {[0, 1, 2].map((index) => (
        <div className="flex items-start gap-3 px-4 py-4 sm:px-5" key={index}>
          <Skeleton className="size-9 shrink-0 rounded-lg" />
          <div className="flex min-w-0 grow flex-col gap-2">
            <Skeleton className="h-3 w-52 max-w-full" />
            <Skeleton className="h-3 w-80 max-w-full" />
          </div>
          <Skeleton className="hidden h-3 w-28 shrink-0 sm:block" />
        </div>
      ))}
    </div>
  );
}

function decodeBase64(value: string) {
  const binary = atob(value);
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}
