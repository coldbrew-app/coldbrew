import { Link, createFileRoute } from "@tanstack/react-router";
import { AddVideoForm } from "@web/components/add-video-form";
import { CosmicPageHeader } from "@web/components/cosmic-page-header";
import { EmptyState } from "@web/components/empty-state";
import { Icons } from "@web/components/icons";
import { VideoListSkeleton } from "@web/components/loading-skeletons";
import { PagePagination } from "@web/components/page-pagination";
import QueryErrorState from "@web/components/query-error-state";
import { SlugEditor } from "@web/components/slug-editor";
import { Button, buttonVariants } from "@web/components/ui/button";
import { FieldError } from "@web/components/ui/field";
import VideoCard from "@web/components/video-card";
import VideoPriorities from "@web/components/video-priorities";
import { VideoQueueControls, VideoQueueSelect } from "@web/components/video-queue-controls";
import { preloadRouteQuery } from "@web/lib/trpc";
import { useEffect, useState } from "react";
import { z } from "zod";

import {
  useUpdateVideoM,
  useUpdateVideoStatusM,
  useVideoPageQ,
  useRetryVideoMetadataM,
  useVideoQueuesQ,
  useVideoQueueMutations,
} from "../../hooks/api";
import { createI18n, createTranslator, useI18n } from "../../lib/i18n";

const i18n = createI18n({
  selectedVideo: {
    en: "Selected video",
    ru: "Выбранное видео",
  },
  showAllVideos: {
    en: "Show all videos",
    ru: "Показать все видео",
  },
  linkedVideoUnavailable: {
    en: "Video not found or unavailable",
    ru: "Видео не найдено или недоступно",
  },
  videoQueue: {
    en: "Video queue",
    ru: "Очередь видео",
  },
  moveToQueue: {
    en: "Move to another queue",
    ru: "Перенести в другую очередь",
  },
  videoMoveFailed: {
    en: "Couldn't move the video. Please try again.",
    ru: "Не удалось перенести видео. Попробуйте ещё раз.",
  },
  all: {
    en: "All",
    ru: "Все",
  },
  notWatched: {
    en: "Not watched",
    ru: "Не просмотрено",
  },
  watched: {
    en: "Watched",
    ru: "Просмотрено",
  },
  bookmarked: {
    en: "Bookmarked",
    ru: "В закладках",
  },
  loadingVideoQueue: {
    en: "Loading video queue",
    ru: "Загружаем очередь видео…",
  },
  noVideos: {
    en: "No videos",
    ru: "Нет видео",
  },
  noVideosInQueue: {
    en: "No videos in the queue",
    ru: "В очереди нет видео",
  },
  noFilteredVideos: {
    en: ({ status }: { status: string }) => `No ${status} videos`,
    ru: ({ status: _status }: { status: string }) => "По этому фильтру ничего не найдено",
  },
  filteredVideosWillAppear: {
    en: "Try another filter.",
    ru: "Выберите другой фильтр.",
  },
  videoLinksWillAppear: {
    en: "Add a video manually or wait for a donation with a video link.",
    ru: "Добавьте видео вручную или дождитесь доната со ссылкой на видео.",
  },
  videoStatusFilters: {
    en: "Video status filters",
    ru: "Фильтр видео по статусу",
  },
  queueConfiguration: {
    en: "Priorities and sharing",
    ru: "Приоритеты и доступ по ссылке",
  },
  addVideo: {
    en: "Add video",
    ru: "Добавить видео",
  },
});

const VideoPageInputSchema = z.object({
  videoQueueId: z.int().positive().optional(),
  page: z.int().positive(),
  videoId: z.string().optional(),
  videoPriorityId: z.union([z.int().positive(), z.literal("unassigned")]).nullable(),
  videoStatus: z.enum(["all", "notwatched", "watched", "bookmarked"]),
});

export const Route = createFileRoute("/_authenticated/videos")({
  component: VideoQueue,
  head: ({ match }) => ({
    meta: [{ title: `${createTranslator(match.context.locale, i18n)("videoQueue")} · StreamBrew` }],
  }),
  validateSearch: z.object({
    videoQueueId: z.coerce.number().int().positive().optional().catch(undefined),
    videoId: z
      .string()
      .regex(/^[1-9][0-9]*$/)
      .optional()
      .catch(undefined),
    page: z.coerce.number().int().positive().default(1).catch(1),
    videoPriorityId: z
      .union([z.literal("all"), z.literal("unassigned"), z.coerce.number().int().positive()])
      .default("all")
      .catch("all"),
    videoStatus: z
      .enum(["all", "notwatched", "watched", "bookmarked"])
      .default("notwatched")
      .catch("notwatched"),
  }),
  loaderDeps: ({ search }) => ({
    videoQueueId: search.videoQueueId,
    page: search.page,
    videoId: search.videoId,
    videoPriorityId: search.videoPriorityId === "all" ? null : search.videoPriorityId,
    videoStatus: search.videoStatus,
  }),
  loader: async ({ context, deps }) => {
    if (!context.viewer) {
      return;
    }
    const videoPageInput = VideoPageInputSchema.parse(deps);
    await Promise.all([
      preloadRouteQuery(context.queryClient, context.trpc.videoPage.queryOptions(videoPageInput)),
      preloadRouteQuery(context.queryClient, context.trpc.videoPriorities.queryOptions()),
      preloadRouteQuery(context.queryClient, context.trpc.videoQueues.queryOptions()),
    ]);
  },
});

function useVideoQueuePage() {
  const [isAddingVideo, setIsAddingVideo] = useState(false);
  const [isQueueSettingsOpen, setIsQueueSettingsOpen] = useState(false);
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const updateVideoStatusM = useUpdateVideoStatusM();
  const updateVideoM = useUpdateVideoM();
  const retryMetadataM = useRetryVideoMetadataM();
  const queuesQ = useVideoQueuesQ();
  const { move } = useVideoQueueMutations();
  const selectedVideoPriorityId = search.videoPriorityId === "all" ? null : search.videoPriorityId;
  const activeTab = search.videoStatus;
  const videosQ = useVideoPageQ({
    videoQueueId: search.videoQueueId,
    page: search.page,
    videoId: search.videoId,
    videoPriorityId: selectedVideoPriorityId,
    videoStatus: activeTab,
  });
  const visibleVideos = videosQ.data?.items ?? [];
  const statusCounts = videosQ.data?.statusCounts ?? {
    all: 0,
    notwatched: 0,
    bookmarked: 0,
    watched: 0,
  };

  useEffect(() => {
    if (
      videosQ.data &&
      !videosQ.isPlaceholderData &&
      (videosQ.data.page !== search.page || search.videoQueueId === undefined)
    ) {
      void navigate({
        replace: true,
        search: (previous) => ({
          ...previous,
          page: videosQ.data.page,
          videoQueueId: videosQ.data.queue.videoQueueId,
        }),
      });
    }
  }, [navigate, search.page, search.videoQueueId, videosQ.data, videosQ.isPlaceholderData]);

  return {
    activeTab,
    isAddingVideo,
    isQueueSettingsOpen,
    move,
    navigate,
    queuesQ,
    retryMetadataM,
    search,
    selectedVideoPriorityId,
    setIsAddingVideo,
    setIsQueueSettingsOpen,
    statusCounts,
    updateVideoM,
    updateVideoStatusM,
    videosQ,
    visibleVideos,
  };
}

type VideoQueuePage = ReturnType<typeof useVideoQueuePage>;
type QueueVideo = NonNullable<VideoQueuePage["videosQ"]["data"]>["items"][number];

function VideoQueueHeader({ page }: { page: VideoQueuePage }) {
  const { t } = useI18n(i18n);
  return (
    <CosmicPageHeader
      title={t("videoQueue")}
      actions={
        <Button
          aria-controls="add-video-form"
          aria-expanded={page.isAddingVideo}
          onClick={() => page.setIsAddingVideo((isOpen) => !isOpen)}
          size="sm"
          type="button"
          variant={page.isAddingVideo ? "secondary" : "default"}
        >
          <Icons.addVideo aria-hidden="true" />
          {t("addVideo")}
        </Button>
      }
    />
  );
}

function OwnerVideoCard({ page, video }: { page: VideoQueuePage; video: QueueVideo }) {
  const { t } = useI18n(i18n);
  const isUpdating =
    page.updateVideoStatusM.isPending ||
    page.updateVideoM.isPending ||
    page.move.isPending ||
    page.retryMetadataM.isPending;
  const queueControl =
    page.queuesQ.data && page.queuesQ.data.length > 1 ? (
      <VideoQueueSelect
        queues={page.queuesQ.data}
        value={video.videoQueueId}
        label={t("moveToQueue")}
        variant="action"
        disabled={page.move.isPending || page.updateVideoM.isPending}
        onChange={(videoQueueId) => page.move.mutate({ videoId: video.videoId, videoQueueId })}
      />
    ) : undefined;

  return (
    <VideoCard
      isUpdating={isUpdating}
      key={video.videoId}
      onRetryMetadata={() => page.retryMetadataM.mutate({ videoId: video.videoId })}
      onStatusChange={(status) =>
        page.updateVideoStatusM.mutate({ videoId: video.videoId, ...status })
      }
      onUpdate={(input) => page.updateVideoM.mutateAsync({ videoId: video.videoId, ...input })}
      queueControl={queueControl}
      showSource
      video={video}
    />
  );
}

function VideoQueueEmptyState({ page }: { page: VideoQueuePage }) {
  const { t } = useI18n(i18n);
  if (page.search.videoId) {
    return (
      <EmptyState
        description={t("showAllVideos")}
        icon={Icons.video}
        title={t("linkedVideoUnavailable")}
      />
    );
  }
  const labels = {
    all: t("all"),
    bookmarked: t("bookmarked"),
    notwatched: t("notWatched"),
    watched: t("watched"),
  };
  const hasAnyVideos = page.statusCounts.all > 0;
  const title = hasAnyVideos
    ? page.activeTab === "all"
      ? t("noVideos")
      : t("noFilteredVideos", { status: labels[page.activeTab].toLowerCase() })
    : t("noVideosInQueue");
  return (
    <EmptyState
      description={hasAnyVideos ? t("filteredVideosWillAppear") : t("videoLinksWillAppear")}
      headingLevel={3}
      icon={Icons.video}
      title={title}
    />
  );
}

function VideoQueueResults({ page }: { page: VideoQueuePage }) {
  const { t } = useI18n(i18n);
  if (page.videosQ.isLoading) {
    return <VideoListSkeleton aria-busy="true" aria-label={t("loadingVideoQueue")} withActions />;
  }
  if (page.videosQ.isError) {
    return (
      <QueryErrorState
        isRetrying={page.videosQ.isFetching}
        onRetry={() => void page.videosQ.refetch()}
      />
    );
  }
  if (page.visibleVideos.length === 0) return <VideoQueueEmptyState page={page} />;
  return (
    <div className="divide-y divide-border">
      {page.visibleVideos.map((video) => (
        <OwnerVideoCard key={video.videoId} page={page} video={video} />
      ))}
    </div>
  );
}

function VideoQueueContent({ page }: { page: VideoQueuePage }) {
  const { t } = useI18n(i18n);
  return (
    <div className="order-2 min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain lg:order-1">
      {page.search.videoId && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-secondary/40 px-4 py-2">
          <p className="text-sm">{t("selectedVideo")}</p>
        </div>
      )}
      {page.isAddingVideo && page.queuesQ.data && page.videosQ.data && (
        <AddVideoForm
          key={page.videosQ.data.queue.videoQueueId}
          onCancel={() => page.setIsAddingVideo(false)}
          queues={page.queuesQ.data}
          videoQueueId={page.videosQ.data.queue.videoQueueId}
        />
      )}
      <div className={page.isQueueSettingsOpen ? "block" : "hidden lg:block"} id="queue-sharing">
        <SlugEditor showAllVideos={Boolean(page.search.videoId)} />
      </div>
      <VideoQueueResults page={page} />
    </div>
  );
}

function VideoStatusFilters({ page }: { page: VideoQueuePage }) {
  const { t } = useI18n(i18n);
  const tabs = [
    { id: "all", label: t("all"), count: page.statusCounts.all, icon: Icons.list },
    {
      id: "notwatched",
      label: t("notWatched"),
      count: page.statusCounts.notwatched,
      icon: Icons.notWatched,
    },
    { id: "watched", label: t("watched"), count: page.statusCounts.watched, icon: Icons.watched },
    {
      id: "bookmarked",
      label: t("bookmarked"),
      count: page.statusCounts.bookmarked,
      icon: Icons.bookmark,
    },
  ] as const;
  return (
    <nav
      className="grid shrink-0 grid-cols-2 gap-1 lg:grid-cols-1"
      aria-label={t("videoStatusFilters")}
    >
      {tabs.map(({ id, label, count, icon: Icon }) => {
        const isActive = id === page.activeTab;
        return (
          <Link
            aria-current={isActive ? "page" : undefined}
            className={buttonVariants({
              className: "h-auto px-3 py-2 text-left text-xs font-semibold",
              variant: isActive ? "secondary" : "ghost",
            })}
            key={id}
            search={(previous) => ({
              videoQueueId: page.videosQ.data?.queue.videoQueueId ?? previous.videoQueueId,
              page: 1,
              videoPriorityId: previous.videoPriorityId ?? "all",
              videoStatus: id,
            })}
            to="/videos"
          >
            <Icon aria-hidden="true" size={15} />
            <span className="grow">{label}</span>
            <span className="text-[10px] font-bold">{count}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function VideoQueueSidebar({ page }: { page: VideoQueuePage }) {
  const { t } = useI18n(i18n);
  return (
    <aside className="relative order-1 flex shrink-0 flex-col overflow-hidden border-b border-border bg-muted/40 p-3 lg:order-2 lg:min-h-0 lg:w-72 lg:border-b-0 lg:border-l">
      <VideoStatusFilters page={page} />
      <div className="shrink-0 pt-2 lg:hidden">
        <Button
          aria-controls="queue-sharing queue-priorities"
          aria-expanded={page.isQueueSettingsOpen}
          className="w-full justify-start"
          onClick={() => page.setIsQueueSettingsOpen((isOpen) => !isOpen)}
          variant="ghost"
        >
          <Icons.settings aria-hidden="true" />
          {t("queueConfiguration")}
        </Button>
      </div>
      <div
        className={`${page.isQueueSettingsOpen ? "block" : "hidden lg:block"} max-h-32 overflow-y-auto overscroll-contain lg:min-h-0 lg:max-h-none lg:flex-1`}
        id="queue-priorities"
      >
        <VideoPriorities
          remainingSecondsByPriorityId={page.videosQ.data?.remainingSecondsByPriorityId ?? {}}
          selectedVideoPriorityId={page.selectedVideoPriorityId}
          videoCountByPriorityId={page.videosQ.data?.priorityCounts ?? {}}
          videoQueueId={page.search.videoQueueId ?? page.videosQ.data?.queue.videoQueueId}
        />
      </div>
    </aside>
  );
}

function VideoQueuePagination({ page }: { page: VideoQueuePage }) {
  const { t } = useI18n(i18n);
  if (!page.videosQ.data || page.videosQ.isError || page.visibleVideos.length === 0) return null;
  return (
    <PagePagination
      isLoading={page.videosQ.isFetching}
      loadingLabel={t("loadingVideoQueue")}
      onPageChange={(nextPage) =>
        void page.navigate({ search: (previous) => ({ ...previous, page: nextPage }) })
      }
      page={page.videosQ.data.page}
      pageSize={page.videosQ.data.pageSize}
      total={page.videosQ.data.total}
      totalPages={page.videosQ.data.totalPages}
    />
  );
}

function VideoQueue() {
  const page = useVideoQueuePage();
  const { t } = useI18n(i18n);

  return (
    <section className="cosmic-panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <VideoQueueHeader page={page} />
      <VideoQueueControls
        videoQueueId={page.search.videoQueueId ?? page.videosQ.data?.queue.videoQueueId}
        onSelect={(videoQueueId) =>
          void page.navigate({
            search: (previous) => ({
              ...previous,
              videoQueueId,
              videoId: undefined,
              page: 1,
              videoPriorityId: "all",
            }),
          })
        }
      />
      {page.move.error && <FieldError className="px-4 py-2">{t("videoMoveFailed")}</FieldError>}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <VideoQueueContent page={page} />
          <VideoQueueSidebar page={page} />
        </div>
      </div>
      <VideoQueuePagination page={page} />
    </section>
  );
}
