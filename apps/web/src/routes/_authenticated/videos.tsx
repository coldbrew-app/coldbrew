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
import VideoCard from "@web/components/video-card";
import VideoPriorities from "@web/components/video-priorities";
import { preloadRouteQuery } from "@web/lib/trpc";
import { useEffect, useState } from "react";
import { z } from "zod";

import { useUpdateVideoM, useUpdateVideoStatusM, useVideoPageQ } from "../../hooks/api";
import { createTranslator, useI18n } from "../../lib/i18n";

const VideoPageInputSchema = z.object({
  page: z.number().int().positive(),
  videoPriorityId: z.number().int().positive().nullable(),
  videoStatus: z.enum(["all", "notwatched", "watched", "saved"]),
});

export const Route = createFileRoute("/_authenticated/videos")({
  component: VideoQueue,
  head: ({ match }) => ({
    meta: [{ title: `${createTranslator(match.context.locale)("videoQueue")} · Coldbrew` }],
  }),
  validateSearch: z.object({
    page: z.coerce.number().int().positive().default(1).catch(1),
    videoPriorityId: z
      .union([z.literal("all"), z.coerce.number().int().positive()])
      .default("all")
      .catch("all"),
    videoStatus: z
      .enum(["all", "notwatched", "watched", "saved"])
      .default("notwatched")
      .catch("notwatched"),
  }),
  loaderDeps: ({ search }) => ({
    page: search.page,
    videoPriorityId: search.videoPriorityId === "all" ? null : search.videoPriorityId,
    videoStatus: search.videoStatus,
  }),
  loader: async ({ context, deps }) => {
    if (!context.viewer) return;
    const videoPageInput = VideoPageInputSchema.parse(deps);
    await Promise.all([
      preloadRouteQuery(context.queryClient, context.trpc.videoPage.queryOptions(videoPageInput)),
      preloadRouteQuery(context.queryClient, context.trpc.videoPriorities.queryOptions()),
    ]);
  },
});

function VideoQueue() {
  const [isAddingVideo, setIsAddingVideo] = useState(false);
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const updateVideoStatusM = useUpdateVideoStatusM();
  const updateVideoM = useUpdateVideoM();
  const { t } = useI18n();
  const selectedVideoPriorityId = search.videoPriorityId === "all" ? null : search.videoPriorityId;
  const activeTab = search.videoStatus;
  const videosQ = useVideoPageQ({
    page: search.page,
    videoPriorityId: selectedVideoPriorityId,
    videoStatus: activeTab,
  });
  const visibleVideos = videosQ.data?.items ?? [];
  const statusCounts = videosQ.data?.statusCounts ?? {
    all: 0,
    notwatched: 0,
    saved: 0,
    watched: 0,
  };

  useEffect(() => {
    if (videosQ.data && !videosQ.isPlaceholderData && videosQ.data.page !== search.page) {
      void navigate({
        replace: true,
        search: (previous) => ({ ...previous, page: videosQ.data!.page }),
      });
    }
  }, [navigate, search.page, videosQ.data]);

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
      id: "saved" satisfies typeof activeTab,
      label: t("saved"),
      count: statusCounts.saved,
      icon: Icons.bookmark,
    },
  ] as const;

  return (
    <section className="flex min-w-0 flex-1 flex-col gap-4">
      <CosmicPageHeader
        description={t("queueOrbitDescription")}
        eyebrow={t("queueOrbit")}
        title={t("videoQueue")}
      />
      <div className="w-full">
        <article className="cosmic-panel overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div className="flex flex-col gap-1">
              <h1 className="font-heading text-lg font-semibold text-card-foreground">
                {t("videoQueue")}
              </h1>
              <p className="text-xs text-muted-foreground">{t("videosForStream")}</p>
            </div>
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
          </div>
          {isAddingVideo && <AddVideoForm onCancel={() => setIsAddingVideo(false)} />}
          <SlugEditor />
          <div className="flex flex-col lg:flex-row">
            <div className="order-2 min-w-0 grow lg:order-1">
              {videosQ.isLoading ? (
                <VideoListSkeleton
                  aria-busy="true"
                  aria-label={t("loadingVideoQueue")}
                  withActions
                />
              ) : videosQ.isError ? (
                <QueryErrorState
                  isRetrying={videosQ.isFetching}
                  onRetry={() => void videosQ.refetch()}
                />
              ) : visibleVideos.length ? (
                <>
                  <div className="divide-y divide-border">
                    {visibleVideos.map((video) => (
                      <VideoCard
                        isUpdating={updateVideoStatusM.isPending || updateVideoM.isPending}
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
                      />
                    ))}
                  </div>
                  <PagePagination
                    isLoading={videosQ.isFetching}
                    loadingLabel={t("loadingVideoQueue")}
                    onPageChange={(page) =>
                      void navigate({ search: (previous) => ({ ...previous, page }) })
                    }
                    page={videosQ.data!.page}
                    pageSize={videosQ.data!.pageSize}
                    total={videosQ.data!.total}
                    totalPages={videosQ.data!.totalPages}
                  />
                </>
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

            <aside className="relative order-1 overflow-hidden border-b border-border bg-secondary/45 p-3 lg:order-2 lg:w-72 lg:shrink-0 lg:border-b-0 lg:border-l">
              <nav className="flex flex-col gap-1" aria-label={t("videoStatusFilters")}>
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
              <VideoPriorities
                selectedVideoPriorityId={selectedVideoPriorityId}
                videoCountByPriorityId={videosQ.data?.priorityCounts ?? {}}
              />
            </aside>
          </div>
        </article>
      </div>
    </section>
  );
}
