import { SlugSchema } from "@coldbrew/packages/schemas.js";
import { getRoundedWatchDurationMinutes } from "@coldbrew/packages/video-timing.js";
import { createFileRoute } from "@tanstack/react-router";
import { CosmicArt } from "@web/components/cosmic-art";
import { EmptyState } from "@web/components/empty-state";
import { Icons } from "@web/components/icons";
import { VideoListSkeleton } from "@web/components/loading-skeletons";
import { PagePagination } from "@web/components/page-pagination";
import VideoCard from "@web/components/video-card";
import { groupVideosByPriority } from "@web/lib/group-videos-by-priority";
import type { Video } from "@web/server/exports";
import { useEffect } from "react";
import { z } from "zod";

import { useSharedVideoPageQ } from "../hooks/api";
import { createTranslator, useI18n } from "../lib/i18n";

const SharedVideoPageDepsSchema = z.object({
  page: z.number().int().positive(),
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
        {t("minutesRemaining", {
          count: getRoundedWatchDurationMinutes(priority.remainingSeconds),
        })}
      </span>
    </header>
  );
}

function SharedVideoGroups({
  items,
  isLastPage,
  priorities,
}: {
  items: Video[];
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
                <VideoCard key={video.videoId} video={video} />
              ))}
            </div>
          );
        }

        return (
          <section key={priority.videoPriorityId}>
            <SharedPriorityHeader priority={priority} />
            <div className="divide-y divide-border">
              {group.videos.map((video) => (
                <VideoCard key={video.videoId} showPriorityLabel={false} video={video} />
              ))}
            </div>
          </section>
        );
      })}
      {unassignedVideos.length > 0 && (
        <div className="divide-y divide-border border-t border-border">
          {unassignedVideos.map((video) => (
            <VideoCard key={video.videoId} video={video} />
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

export const Route = createFileRoute("/share/$slug")({
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
  }),
  loaderDeps: ({ search }) => ({ page: search.page }),
  loader: ({ context, deps, params }) =>
    context.queryClient.ensureQueryData(
      context.trpc.sharedVideoPage.queryOptions({
        page: SharedVideoPageDepsSchema.parse(deps).page,
        slug: params.slug,
      }),
    ),
});

function SharedVideoQueue() {
  const { slug } = Route.useParams();
  const { page } = Route.useSearch();
  const navigate = Route.useNavigate();
  const videosQ = useSharedVideoPageQ(slug, page);
  const { t } = useI18n();

  useEffect(() => {
    if (videosQ.data && !videosQ.isPlaceholderData && videosQ.data.page !== page) {
      void navigate({ replace: true, search: { page: videosQ.data.page } });
    }
  }, [navigate, page, videosQ.data]);

  return (
    <main className="relative min-h-dvh overflow-hidden bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-foreground sm:p-8">
      <div className="cosmic-grid pointer-events-none absolute inset-0 opacity-35" />
      <section className="cosmic-panel relative mx-auto w-full max-w-4xl overflow-hidden">
        <header className="cosmic-hero relative flex min-h-48 flex-col justify-center gap-2 overflow-hidden p-5 text-white sm:p-8">
          <span className="relative z-10 text-[10px] font-bold tracking-[0.18em] text-[#ffcf69] uppercase">
            {t("publicQueueEyebrow")}
          </span>
          <h1 className="relative z-10 max-w-xl font-heading text-[clamp(28px,5vw,44px)] leading-none font-semibold">
            {t("videoQueueBy", { slug })}
          </h1>
          <p className="relative z-10 max-w-md text-xs leading-relaxed text-white/70">
            {t("videosSharedBySupporters")}
          </p>
          <CosmicArt
            className="pointer-events-none absolute -right-6 -bottom-12 w-72"
            variant="orbit"
          />
        </header>
        {videosQ.isLoading ? (
          <VideoListSkeleton aria-busy="true" aria-label={t("loadingVideoQueue")} />
        ) : videosQ.data ? (
          <>
            <SharedVideoGroups
              isLastPage={
                videosQ.data.totalPages === 0 || videosQ.data.page === videosQ.data.totalPages
              }
              items={videosQ.data.items}
              priorities={videosQ.data.priorities}
            />
            {videosQ.data.items.length ? (
              <PagePagination
                isLoading={videosQ.isFetching}
                loadingLabel={t("loadingVideoQueue")}
                onPageChange={(nextPage) => void navigate({ search: { page: nextPage } })}
                page={videosQ.data.page}
                pageSize={videosQ.data.pageSize}
                total={videosQ.data.total}
                totalPages={videosQ.data.totalPages}
              />
            ) : (
              <EmptyState
                description={t("videoLinksWillAppear")}
                headingLevel={2}
                icon={Icons.wallet}
                title={t("noVideosInQueue")}
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
