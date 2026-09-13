import { getRoundedWatchDurationParts } from "@coldbrew/packages/video-timing.js";
import { Link, createFileRoute } from "@tanstack/react-router";
import { CosmicPageHeader } from "@web/components/cosmic-page-header";
import { EmptyState } from "@web/components/empty-state";
import { Icons } from "@web/components/icons";
import { VideoListSkeleton } from "@web/components/loading-skeletons";
import { PagePagination } from "@web/components/page-pagination";
import QueryErrorState from "@web/components/query-error-state";
import { SharedVideoCard } from "@web/components/shared-video-card";
import { buttonVariants } from "@web/components/ui/button";
import { useSharedVideoPageQ } from "@web/hooks/api";
import { groupVideosByPriority } from "@web/lib/group-videos-by-priority";
import { createI18n, createTranslator, useI18n } from "@web/lib/i18n";
import { slugParams } from "@web/lib/slug-params";
import type { SharedVideo } from "@web/server/exports";
import { useEffect } from "react";
import { z } from "zod";

type HourMinuteParts = {
  hours: number;
  minutes: number;
};

const i18n = createI18n({
  videoQueues: {
    en: "Video queues",
    ru: "Очереди видео",
  },
  watched: {
    en: "Watched",
    ru: "Просмотрено",
  },
  loadingVideoQueue: {
    en: "Loading video queue",
    ru: "Загружаем очередь видео…",
  },
  noVideosInQueue: {
    en: "No videos in the queue",
    ru: "В очереди нет видео",
  },
  videoLinksWillAppear: {
    en: "Videos from donations and videos you add will appear here.",
    ru: "Здесь появятся видео из донатов и добавленные вручную.",
  },
  videoUnassigned: {
    en: "Without priority",
    ru: "Без приоритета",
  },
  durationRemaining: {
    en: ({ hours, minutes }: HourMinuteParts) => `${hours > 0 ? `${hours} hr ` : ""}${minutes} min`,
    ru: ({ hours, minutes }: HourMinuteParts) => `${hours > 0 ? `${hours} ч ` : ""}${minutes} мин`,
  },
  videoQueueBy: {
    en: ({ slug }: { slug: string }) => `Video queue: ${slug}`,
    ru: ({ slug }: { slug: string }) => `Очередь видео — ${slug}`,
  },
  publicQueueTabs: {
    en: "Public video queue sections",
    ru: "Разделы публичной очереди",
  },
  currentQueue: {
    en: "Queue",
    ru: "Сейчас в очереди",
  },
  noWatchedVideos: {
    en: "No watched videos",
    ru: "Просмотренных видео пока нет",
  },
  watchedVideosWillAppear: {
    en: "Videos will appear here after the streamer watches them.",
    ru: "После просмотра видео появятся здесь.",
  },
  queueNotFound: {
    en: "Queue not found",
    ru: "Очередь недоступна",
  },
  sharedQueueUnavailable: {
    en: "This video queue is unavailable.",
    ru: "Возможно, ссылка неверна или владелец закрыл доступ.",
  },
});

const SharedVideoPageDepsSchema = z.object({
  videoQueueId: z.int().positive().optional(),
  page: z.int().positive(),
  status: z.enum(["queue", "watched"]),
});

type SharedPriority = {
  videoPriorityId: number;
  label: string;
  remainingSeconds: number;
};

function SharedPriorityHeader({ priority }: { priority: SharedPriority }) {
  const { t } = useI18n(i18n);

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
  const { t } = useI18n(i18n);
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
          <h2 className="bg-secondary/50 px-4 py-2.5 font-heading text-sm font-semibold">
            {t("videoUnassigned")}
          </h2>
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

export const Route = createFileRoute("/$slug/videos")({
  component: SharedVideoQueue,
  head: ({ match, params }) => ({
    meta: [
      {
        title: `${createTranslator(match.context.locale, i18n)("videoQueueBy", { slug: `@${params.slug}` })} · Coldbrew`,
      },
    ],
  }),
  params: slugParams,
  validateSearch: z.object({
    videoQueueId: z.coerce.number().int().positive().optional().catch(undefined),
    page: z.coerce.number().int().positive().default(1).catch(1),
    status: z.enum(["queue", "watched"]).default("queue").catch("queue"),
  }),
  loaderDeps: ({ search }) => ({
    page: search.page,
    status: search.status,
    videoQueueId: search.videoQueueId,
  }),
  loader: ({ context, deps, params }) =>
    context.queryClient.ensureQueryData(
      context.trpc.sharedVideoPage.queryOptions({
        ...SharedVideoPageDepsSchema.parse(deps),
        slug: params.slug,
      }),
    ),
});

function useSharedVideoQueuePage() {
  const { slug } = Route.useParams();
  const { page, status, videoQueueId } = Route.useSearch();
  const navigate = Route.useNavigate();
  const videosQ = useSharedVideoPageQ(slug, page, status, videoQueueId);

  useEffect(() => {
    const data = videosQ.data;
    if (data && !videosQ.isPlaceholderData && (data.page !== page || data.status !== status)) {
      void navigate({
        replace: true,
        search: (previous) => ({ ...previous, page: data.page, status: data.status }),
      });
    }
  }, [navigate, page, status, videosQ.data, videosQ.isPlaceholderData]);

  return {
    displayedStatus: videosQ.data?.status ?? status,
    navigate,
    selectedQueueId: videosQ.data?.videoQueueId,
    slug,
    videoQueueId,
    videosQ,
  };
}

type SharedVideoQueuePage = ReturnType<typeof useSharedVideoQueuePage>;

function SharedQueueNavigation({ page }: { page: SharedVideoQueuePage }) {
  const { t } = useI18n(i18n);
  if (!page.videosQ.data) return null;
  return (
    <nav
      aria-label={t("videoQueues")}
      className="flex shrink-0 flex-wrap gap-1 border-b border-border p-2"
    >
      {page.videosQ.data.queues.map((queue) => (
        <Link
          aria-current={page.selectedQueueId === queue.videoQueueId ? "page" : undefined}
          className={buttonVariants({
            className: "max-w-full",
            size: "sm",
            variant: page.selectedQueueId === queue.videoQueueId ? "secondary" : "ghost",
          })}
          key={queue.videoQueueId}
          params={{ slug: page.slug }}
          search={(previous) => ({ ...previous, videoQueueId: queue.videoQueueId, page: 1 })}
          to="/$slug/videos"
        >
          <span className="truncate">{queue.label}</span>
        </Link>
      ))}
    </nav>
  );
}

function SharedQueueStatusNavigation({ page }: { page: SharedVideoQueuePage }) {
  const { t } = useI18n(i18n);
  const data = page.videosQ.data;
  if (!data) return null;
  const statusLink = (status: "queue" | "watched") => ({
    page: 1,
    status,
    videoQueueId: page.videoQueueId,
  });
  return (
    <nav
      aria-label={t("publicQueueTabs")}
      className="flex shrink-0 gap-1 border-b border-border bg-secondary/35 p-2"
    >
      <Link
        aria-current={data.status === "queue" ? "page" : undefined}
        className={buttonVariants({
          className: "grow sm:grow-0",
          size: "sm",
          variant: data.status === "queue" ? "secondary" : "ghost",
        })}
        params={{ slug: page.slug }}
        search={statusLink("queue")}
        to="/$slug/videos"
      >
        <Icons.list aria-hidden="true" size={15} />
        {t("currentQueue")}
      </Link>
      {data.showWatchedVideos && (
        <Link
          aria-current={data.status === "watched" ? "page" : undefined}
          className={buttonVariants({
            className: "grow sm:grow-0",
            size: "sm",
            variant: data.status === "watched" ? "secondary" : "ghost",
          })}
          params={{ slug: page.slug }}
          search={statusLink("watched")}
          to="/$slug/videos"
        >
          <Icons.watched aria-hidden="true" size={15} />
          {t("watched")}
        </Link>
      )}
    </nav>
  );
}

function SharedQueueVideos({ page }: { page: SharedVideoQueuePage }) {
  const { t } = useI18n(i18n);
  const data = page.videosQ.data;
  if (!data) return null;
  const isQueue = data.status === "queue";
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      {isQueue ? (
        <SharedVideoGroups
          isLastPage={data.totalPages === 0 || data.page === data.totalPages}
          items={data.items}
          priorities={data.priorities}
        />
      ) : (
        <div className="divide-y divide-border">
          {data.items.map((video) => (
            <SharedVideoCard key={video.videoId} video={video} />
          ))}
        </div>
      )}
      {data.items.length === 0 && (
        <EmptyState
          description={t(isQueue ? "videoLinksWillAppear" : "watchedVideosWillAppear")}
          headingLevel={2}
          icon={isQueue ? Icons.wallet : Icons.watched}
          title={t(isQueue ? "noVideosInQueue" : "noWatchedVideos")}
        />
      )}
    </div>
  );
}

function SharedQueuePagination({ page }: { page: SharedVideoQueuePage }) {
  const { t } = useI18n(i18n);
  const data = page.videosQ.data;
  if (!data || data.items.length === 0) return null;
  return (
    <PagePagination
      isLoading={page.videosQ.isFetching}
      loadingLabel={t("loadingVideoQueue")}
      onPageChange={(nextPage) =>
        void page.navigate({
          search: {
            page: nextPage,
            status: page.displayedStatus,
            videoQueueId: page.videoQueueId,
          },
        })
      }
      page={data.page}
      pageSize={data.pageSize}
      total={data.total}
      totalPages={data.totalPages}
    />
  );
}

function SharedQueueData({ page }: { page: SharedVideoQueuePage }) {
  return (
    <>
      <SharedQueueNavigation page={page} />
      <SharedQueueStatusNavigation page={page} />
      <SharedQueueVideos page={page} />
      <SharedQueuePagination page={page} />
    </>
  );
}

function SharedQueueState({ page }: { page: SharedVideoQueuePage }) {
  const { t } = useI18n(i18n);
  if (page.videosQ.isLoading) {
    return <VideoListSkeleton aria-busy="true" aria-label={t("loadingVideoQueue")} />;
  }
  if (page.videosQ.isError) {
    return (
      <QueryErrorState
        isRetrying={page.videosQ.isFetching}
        onRetry={() => void page.videosQ.refetch()}
      />
    );
  }
  if (page.videosQ.data) return <SharedQueueData page={page} />;
  return (
    <EmptyState
      description={t("sharedQueueUnavailable")}
      headingLevel={2}
      icon={Icons.wallet}
      title={t("queueNotFound")}
    />
  );
}

function SharedVideoQueue() {
  const page = useSharedVideoQueuePage();
  const { t } = useI18n(i18n);

  return (
    <main className="relative h-dvh overflow-hidden bg-background p-0 text-foreground sm:p-3">
      <div className="cosmic-starlight pointer-events-none absolute inset-0" />
      <section className="cosmic-panel relative mx-auto flex h-full min-h-0 w-full max-w-4xl flex-col overflow-hidden">
        <CosmicPageHeader title={t("videoQueueBy", { slug: `@${page.slug}` })} />
        <SharedQueueState page={page} />
      </section>
    </main>
  );
}
