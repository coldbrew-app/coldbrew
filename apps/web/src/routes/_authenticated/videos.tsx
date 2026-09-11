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
    en: "Move to queue",
    ru: "Перенести в очередь",
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
    en: "Videos matching this filter will appear here.",
    ru: "Попробуйте выбрать другой фильтр.",
  },
  videoLinksWillAppear: {
    en: "Videos from donations and videos you add will appear here.",
    ru: "Здесь появятся видео из донатов и добавленные вручную.",
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
    meta: [{ title: `${createTranslator(match.context.locale, i18n)("videoQueue")} · Coldbrew` }],
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

function VideoQueue() {
  const [isAddingVideo, setIsAddingVideo] = useState(false);
  const [isQueueSettingsOpen, setIsQueueSettingsOpen] = useState(false);
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const updateVideoStatusM = useUpdateVideoStatusM();
  const updateVideoM = useUpdateVideoM();
  const retryMetadataM = useRetryVideoMetadataM();
  const queuesQ = useVideoQueuesQ();
  const { move } = useVideoQueueMutations();
  const { t } = useI18n(i18n);
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

  const tabs = [
    {
      id: "all" satisfies typeof activeTab,
      label: t("all"),
      count: statusCounts.all,
      icon: Icons.list,
    },
    {
      id: "notwatched" satisfies typeof activeTab,
      label: t("notWatched"),
      count: statusCounts.notwatched,
      icon: Icons.notWatched,
    },
    {
      id: "watched" satisfies typeof activeTab,
      label: t("watched"),
      count: statusCounts.watched,
      icon: Icons.watched,
    },
    {
      id: "bookmarked" satisfies typeof activeTab,
      label: t("bookmarked"),
      count: statusCounts.bookmarked,
      icon: Icons.bookmark,
    },
  ] as const;

  return (
    <section className="cosmic-panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <CosmicPageHeader
        title={t("videoQueue")}
        actions={
          <Button
            aria-controls="add-video-form"
            aria-expanded={isAddingVideo}
            onClick={() => setIsAddingVideo((isOpen) => !isOpen)}
            size="sm"
            type="button"
            variant={isAddingVideo ? "secondary" : "default"}
          >
            <Icons.addVideo aria-hidden="true" />
            {t("addVideo")}
          </Button>
        }
      />
      <VideoQueueControls
        videoQueueId={search.videoQueueId ?? videosQ.data?.queue.videoQueueId}
        onSelect={(videoQueueId) =>
          void navigate({
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
      {move.error && <FieldError className="px-4 py-2">{t("videoMoveFailed")}</FieldError>}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="order-2 min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain lg:order-1">
            {search.videoId && (
              <div className="flex flex-wrap items-center gap-2 border-b border-border bg-secondary/40 px-4 py-2">
                <p className="text-sm">{t("selectedVideo")}</p>
              </div>
            )}
            {isAddingVideo && queuesQ.data && videosQ.data && (
              <AddVideoForm
                key={videosQ.data.queue.videoQueueId}
                queues={queuesQ.data}
                videoQueueId={videosQ.data.queue.videoQueueId}
                onCancel={() => setIsAddingVideo(false)}
              />
            )}
            <div className={isQueueSettingsOpen ? "block" : "hidden lg:block"} id="queue-sharing">
              <SlugEditor showAllVideos={Boolean(search.videoId)} />
            </div>

            {videosQ.isLoading ? (
              <VideoListSkeleton aria-busy="true" aria-label={t("loadingVideoQueue")} withActions />
            ) : videosQ.isError ? (
              <QueryErrorState
                isRetrying={videosQ.isFetching}
                onRetry={() => void videosQ.refetch()}
              />
            ) : visibleVideos.length ? (
              <div className="divide-y divide-border">
                {visibleVideos.map((video) => (
                  <VideoCard
                    isUpdating={
                      updateVideoStatusM.isPending ||
                      updateVideoM.isPending ||
                      move.isPending ||
                      retryMetadataM.isPending
                    }
                    onRetryMetadata={() => retryMetadataM.mutate({ videoId: video.videoId })}
                    key={video.videoId}
                    onUpdate={(input) =>
                      updateVideoM.mutateAsync({
                        videoId: video.videoId,
                        ...input,
                      })
                    }
                    onStatusChange={(status) =>
                      updateVideoStatusM.mutate({ videoId: video.videoId, ...status })
                    }
                    showSource
                    video={video}
                    queueControl={
                      queuesQ.data && queuesQ.data.length > 1 ? (
                        <VideoQueueSelect
                          queues={queuesQ.data}
                          value={video.videoQueueId}
                          label={t("moveToQueue")}
                          disabled={move.isPending || updateVideoM.isPending}
                          onChange={(videoQueueId) =>
                            move.mutate({ videoId: video.videoId, videoQueueId })
                          }
                        />
                      ) : undefined
                    }
                  />
                ))}
              </div>
            ) : search.videoId ? (
              <EmptyState
                title={t("linkedVideoUnavailable")}
                description={t("showAllVideos")}
                icon={Icons.video}
              />
            ) : (
              <EmptyState
                description={
                  statusCounts.all ? t("filteredVideosWillAppear") : t("videoLinksWillAppear")
                }
                headingLevel={3}
                icon={Icons.video}
                title={
                  statusCounts.all
                    ? activeTab !== "all"
                      ? t("noFilteredVideos", {
                          status:
                            tabs.find((tab) => tab.id === activeTab)?.label.toLowerCase() ?? "",
                        })
                      : t("noVideos")
                    : t("noVideosInQueue")
                }
              />
            )}
          </div>

          <aside className="relative order-1 flex shrink-0 flex-col overflow-hidden border-b border-border bg-muted/40 p-3 lg:order-2 lg:min-h-0 lg:w-72 lg:border-b-0 lg:border-l">
            <nav
              className="grid shrink-0 grid-cols-2 gap-1 lg:grid-cols-1"
              aria-label={t("videoStatusFilters")}
            >
              {tabs.map(({ id, label, count, icon: Icon }) => {
                const isActive = id === activeTab;
                return (
                  <Link
                    aria-current={isActive ? "page" : undefined}
                    className={buttonVariants({
                      className: "h-auto px-3 py-2 text-left text-xs font-semibold",
                      variant: isActive ? "secondary" : "ghost",
                    })}
                    key={id}
                    search={(previous) => ({
                      videoQueueId: videosQ.data?.queue.videoQueueId ?? previous.videoQueueId,
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
            <div className="shrink-0 pt-2 lg:hidden">
              <Button
                aria-controls="queue-sharing queue-priorities"
                aria-expanded={isQueueSettingsOpen}
                className="w-full justify-start"
                onClick={() => setIsQueueSettingsOpen((isOpen) => !isOpen)}
                variant="ghost"
              >
                <Icons.settings aria-hidden="true" />
                {t("queueConfiguration")}
              </Button>
            </div>
            <div
              className={`${isQueueSettingsOpen ? "block" : "hidden lg:block"} max-h-32 overflow-y-auto overscroll-contain lg:min-h-0 lg:max-h-none lg:flex-1`}
              id="queue-priorities"
            >
              <VideoPriorities
                videoQueueId={search.videoQueueId ?? videosQ.data?.queue.videoQueueId}
                remainingSecondsByPriorityId={videosQ.data?.remainingSecondsByPriorityId ?? {}}
                selectedVideoPriorityId={selectedVideoPriorityId}
                videoCountByPriorityId={videosQ.data?.priorityCounts ?? {}}
              />
            </div>
          </aside>
        </div>
      </div>
      {videosQ.data && !videosQ.isError && visibleVideos.length > 0 && (
        <PagePagination
          isLoading={videosQ.isFetching}
          loadingLabel={t("loadingVideoQueue")}
          onPageChange={(page) => void navigate({ search: (previous) => ({ ...previous, page }) })}
          page={videosQ.data.page}
          pageSize={videosQ.data.pageSize}
          total={videosQ.data.total}
          totalPages={videosQ.data.totalPages}
        />
      )}
    </section>
  );
}
