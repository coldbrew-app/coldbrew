import { SlugSchema } from "@coldbrew/packages/schemas.js";
import { getRoundedWatchDurationParts } from "@coldbrew/packages/video-timing.js";
import { Link, createFileRoute } from "@tanstack/react-router";
import { CosmicArt } from "@web/components/cosmic-art";
import { EmptyState } from "@web/components/empty-state";
import { Icons } from "@web/components/icons";
import { VideoListSkeleton } from "@web/components/loading-skeletons";
import { PagePagination } from "@web/components/page-pagination";
import { SharedVideoCard } from "@web/components/shared-video-card";
import { buttonVariants } from "@web/components/ui/button";
import { groupVideosByPriority } from "@web/lib/group-videos-by-priority";
import type { SharedVideo } from "@web/server/exports";
import { useEffect } from "react";
import { z } from "zod";

import { useSharedVideoPageQ } from "../hooks/api";
import { createTranslator, useI18n } from "../lib/i18n";

const SharedVideoPageDepsSchema = z.object({
  page: z.int().positive(),
  status: z.enum(["queue", "watched"]),
});

type SharedPriority = {
  videoPriorityId: number;
  label: string;
  remainingSeconds: number;
};

function SharedPriorityHeader({ priority }: { priority: SharedPriority }) {
  const { t } = useI18n();

  return (
    <header className="flex items-center justify-between gap-4 border-y border-border bg-secondary/50 px-4 py-2.5 sm:px-5">
      <h2 className="min-w-0 truncate font-heading text-sm font-semibold text-card-foreground">
        {priority.label}
      </h2>
      <span className="shrink-0 text-[11px] font-semibold text-primary">
        {t("durationRemaining", getRoundedWatchDurationParts(priority.remainingSeconds))}
      </span>
    </header>
  );
}

function SharedVideoGroups({
  items,
  isLastPage,
  priorities,
}: {
  items: SharedVideo[];
  isLastPage: boolean;
  priorities: Array<SharedPriority & { videoCount: number }>;
}) {
  const { groups, unassignedVideos } = groupVideosByPriority(items);
  const emptyPriorities = isLastPage
    ? priorities.filter((priority) => priority.videoCount === 0)
    : [];

  return (
    <div>
      {groups.map((group) => {
        const priority = priorities.find(
          ({ videoPriorityId }) => videoPriorityId === group.videoPriorityId,
        );
        if (!priority) {
          return (
            <div className="divide-y divide-border" key={group.videoPriorityId}>
              {group.videos.map((video) => (
                <SharedVideoCard key={video.videoId} video={video} />
              ))}
            </div>
          );
        }

        return (
          <section key={priority.videoPriorityId}>
            <SharedPriorityHeader priority={priority} />
            <div className="divide-y divide-border">
              {group.videos.map((video) => (
                <SharedVideoCard key={video.videoId} showPriorityLabel={false} video={video} />
              ))}
            </div>
          </section>
        );
      })}
      {unassignedVideos.length > 0 && (
        <div className="divide-y divide-border border-t border-border">
          {unassignedVideos.map((video) => (
            <SharedVideoCard key={video.videoId} video={video} />
          ))}
        </div>
      )}
      {emptyPriorities.map((priority) => (
        <section key={priority.videoPriorityId}>
          <SharedPriorityHeader priority={priority} />
        </section>
      ))}
    </div>
  );
}

export const Route = createFileRoute("/videos/$slug")({
  component: SharedVideoQueue,
  head: ({ match, params }) => ({
    meta: [
      {
        title: `${createTranslator(match.context.locale)("videoQueueBy", { slug: params.slug })} · Coldbrew`,
      },
    ],
  }),
  params: z.object({
    slug: SlugSchema,
  }),
  validateSearch: z.object({
    page: z.coerce.number().int().positive().default(1).catch(1),
    status: z.enum(["queue", "watched"]).default("queue").catch("queue"),
  }),
  loaderDeps: ({ search }) => ({ page: search.page, status: search.status }),
  loader: ({ context, deps, params }) =>
    context.queryClient.ensureQueryData(
      context.trpc.sharedVideoPage.queryOptions({
        ...SharedVideoPageDepsSchema.parse(deps),
        slug: params.slug,
      }),
    ),
});

function SharedVideoQueue() {
  const { slug } = Route.useParams();
  const { page, status } = Route.useSearch();
  const navigate = Route.useNavigate();
  const videosQ = useSharedVideoPageQ(slug, page, status);
  const { t } = useI18n();

  useEffect(() => {
    if (
      videosQ.data &&
      !videosQ.isPlaceholderData &&
      (videosQ.data.page !== page || videosQ.data.status !== status)
    ) {
      void navigate({
        replace: true,
        search: { page: videosQ.data.page, status: videosQ.data.status },
      });
    }
  }, [navigate, page, status, videosQ.data, videosQ.isPlaceholderData]);

  const displayedStatus = videosQ.data?.status ?? status;

  return (
    <main className="relative h-dvh overflow-hidden bg-background p-0 text-foreground sm:p-3">
      <div className="cosmic-starlight pointer-events-none absolute inset-0" />
      <section className="cosmic-panel relative mx-auto flex h-full min-h-0 w-full max-w-4xl flex-col overflow-hidden">
        <header className="cosmic-page-scene relative flex shrink-0 flex-col justify-center gap-1 overflow-hidden px-4 py-3 text-white sm:px-5 sm:py-4">
          <span className="sr-only text-[#e6bf96]">{t("publicQueueEyebrow")}</span>
          <h1 className="relative z-10 max-w-xl sm:pr-28 font-heading text-xl leading-tight font-semibold">
            {t("videoQueueBy", { slug })}
          </h1>
          <p className="relative z-10 max-w-md text-xs leading-relaxed text-[#dec9bf]">
            {t("videosSharedBySupporters")}
          </p>
          <CosmicArt
            className="pointer-events-none absolute -right-8 -bottom-14 w-48 opacity-30 sm:w-72 sm:opacity-80"
            variant="orbit"
          />
        </header>
        {videosQ.isLoading ? (
          <VideoListSkeleton aria-busy="true" aria-label={t("loadingVideoQueue")} />
        ) : videosQ.data ? (
          <>
            <nav
              aria-label={t("publicQueueTabs")}
              className="flex shrink-0 gap-1 border-b border-border bg-secondary/35 p-2"
            >
              <Link
                aria-current={videosQ.data.status === "queue" ? "page" : undefined}
                className={buttonVariants({
                  className: "grow sm:grow-0",
                  size: "sm",
                  variant: videosQ.data.status === "queue" ? "secondary" : "ghost",
                })}
                params={{ slug }}
                search={{ page: 1, status: "queue" }}
                to="/videos/$slug"
              >
                <Icons.list aria-hidden="true" size={15} />
                {t("currentQueue")}
              </Link>
              {videosQ.data.showWatchedVideos && (
                <Link
                  aria-current={videosQ.data.status === "watched" ? "page" : undefined}
                  className={buttonVariants({
                    className: "grow sm:grow-0",
                    size: "sm",
                    variant: videosQ.data.status === "watched" ? "secondary" : "ghost",
                  })}
                  params={{ slug }}
                  search={{ page: 1, status: "watched" }}
                  to="/videos/$slug"
                >
                  <Icons.watched aria-hidden="true" size={15} />
                  {t("watched")}
                </Link>
              )}
            </nav>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {videosQ.data.status === "queue" ? (
                <SharedVideoGroups
                  isLastPage={
                    videosQ.data.totalPages === 0 || videosQ.data.page === videosQ.data.totalPages
                  }
                  items={videosQ.data.items}
                  priorities={videosQ.data.priorities}
                />
              ) : (
                <div className="divide-y divide-border">
                  {videosQ.data.items.map((video) => (
                    <SharedVideoCard key={video.videoId} video={video} />
                  ))}
                </div>
              )}
              {videosQ.data.items.length === 0 && (
                <EmptyState
                  description={t(
                    videosQ.data.status === "queue"
                      ? "videoLinksWillAppear"
                      : "watchedVideosWillAppear",
                  )}
                  headingLevel={2}
                  icon={videosQ.data.status === "queue" ? Icons.wallet : Icons.watched}
                  title={t(videosQ.data.status === "queue" ? "noVideosInQueue" : "noWatchedVideos")}
                />
              )}
            </div>
            {videosQ.data.items.length > 0 && (
              <PagePagination
                isLoading={videosQ.isFetching}
                loadingLabel={t("loadingVideoQueue")}
                onPageChange={(nextPage) =>
                  void navigate({ search: { page: nextPage, status: displayedStatus } })
                }
                page={videosQ.data.page}
                pageSize={videosQ.data.pageSize}
                total={videosQ.data.total}
                totalPages={videosQ.data.totalPages}
              />
            )}
          </>
        ) : (
          <EmptyState
            description={t("sharedQueueUnavailable")}
            headingLevel={2}
            icon={Icons.wallet}
            title={t("queueNotFound")}
          />
        )}
      </section>
    </main>
  );
}
