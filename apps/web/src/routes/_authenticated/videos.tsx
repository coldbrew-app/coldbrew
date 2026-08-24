import { Link, createFileRoute } from "@tanstack/react-router";
import { AddVideoForm } from "@web/components/add-video-form";
import { CosmicArt } from "@web/components/cosmic-art";
import { CosmicPageHeader } from "@web/components/cosmic-page-header";
import { Icons } from "@web/components/icons";
import { VideoListSkeleton } from "@web/components/loading-skeletons";
import QueryErrorState from "@web/components/query-error-state";
import { SlugEditor } from "@web/components/slug-editor";
import { Button, buttonVariants } from "@web/components/ui/button";
import VideoCard from "@web/components/video-card";
import VideoPriorities from "@web/components/video-priorities";
import { preloadRouteQuery } from "@web/lib/trpc";
import { useState } from "react";
import { z } from "zod";

import { useUpdateVideoM, useUpdateVideoStatusM, useVideosQ } from "../../hooks/api";
import { createTranslator, useI18n } from "../../lib/i18n";

export const Route = createFileRoute("/_authenticated/videos")({
  component: VideoQueue,
  head: ({ match }) => ({
    meta: [{ title: `${createTranslator(match.context.locale)("videoQueue")} · Coldbrew` }],
  }),
  loader: async ({ context }) => {
    if (!context.viewer) return;
    await Promise.all([
      preloadRouteQuery(context.queryClient, context.trpc.videos.queryOptions()),
      preloadRouteQuery(context.queryClient, context.trpc.videoPriorities.queryOptions()),
    ]);
  },
  validateSearch: z.object({
    videoPriorityId: z
      .union([z.literal("all"), z.coerce.number().int().positive()])
      .default("all")
      .catch("all"),
    videoStatus: z
      .enum(["all", "notwatched", "watched", "saved"])
      .default("notwatched")
      .catch("notwatched"),
  }),
});

function VideoQueue() {
  const [isAddingVideo, setIsAddingVideo] = useState(false);
  const videosQ = useVideosQ();
  const updateVideoStatusM = useUpdateVideoStatusM();
  const updateVideoM = useUpdateVideoM();
  const { t } = useI18n();
  const selectedVideoPriorityId = Route.useSearch({
    select: (search) => (search.videoPriorityId === "all" ? null : search.videoPriorityId),
  });
  const activeTab = Route.useSearch({ select: (search) => search.videoStatus });
  const videos = videosQ.data ?? [];
  const videosForActiveStatus = videos.filter((video) => {
    if (activeTab === "all") return true;
    if (activeTab === "notwatched") return video.watchedAt === null;
    if (activeTab === "watched") return video.watchedAt !== null;
    return video.savedAt !== null;
  });
  const videoCountByPriorityId = videosForActiveStatus.reduce<Record<number, number>>(
    (counts, video) => {
      if (video.videoPriorityId !== null) {
        counts[video.videoPriorityId] = (counts[video.videoPriorityId] ?? 0) + 1;
      }
      return counts;
    },
    {},
  );
  const visibleVideos = videosForActiveStatus
    .filter(
      (video) =>
        selectedVideoPriorityId === null || video.videoPriorityId === selectedVideoPriorityId,
    )
    .sort((left, right) => {
      const leftDate =
        activeTab === "watched"
          ? left.watchedAt
          : activeTab === "saved"
            ? left.savedAt
            : left.createdAt;
      const rightDate =
        activeTab === "watched"
          ? right.watchedAt
          : activeTab === "saved"
            ? right.savedAt
            : right.createdAt;

      return rightDate!.getTime() - leftDate!.getTime() || Number(right.videoId - left.videoId);
    });

  const tabs = [
    {
      id: "all" satisfies typeof activeTab,
      label: t("all"),
      count: videos.length,
      icon: Icons.list,
    },
    {
      id: "notwatched" satisfies typeof activeTab,
      label: t("notWatched"),
      count: videos.filter((video) => video.watchedAt === null).length,
      icon: Icons.notWatched,
    },
    {
      id: "watched" satisfies typeof activeTab,
      label: t("watched"),
      count: videos.filter((video) => video.watchedAt !== null).length,
      icon: Icons.watched,
    },
    {
      id: "saved" satisfies typeof activeTab,
      label: t("saved"),
      count: videos.filter((video) => video.savedAt !== null).length,
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
              ) : (
                <div className="grid min-h-64 place-items-center px-5 text-center">
                  <div className="relative flex flex-col items-center gap-2 overflow-hidden">
                    <CosmicArt
                      className="absolute -top-14 -right-28 w-40 text-primary/20 opacity-25"
                      variant="orbit"
                    />
                    <div className="grid size-11 place-items-center rounded-xl bg-secondary text-secondary-foreground">
                      <Icons.video aria-hidden="true" size={20} />
                    </div>
                    <h3 className="text-sm font-semibold text-card-foreground">
                      {videos.length
                        ? activeTab !== "all"
                          ? t("noFilteredVideos", {
                              status:
                                tabs.find((tab) => tab.id === activeTab)?.label.toLowerCase() ?? "",
                            })
                          : t("noVideos")
                        : t("noVideosInQueue")}
                    </h3>
                    <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
                      {videos.length ? t("filteredVideosWillAppear") : t("videoLinksWillAppear")}
                    </p>
                  </div>
                </div>
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
                videoCountByPriorityId={videoCountByPriorityId}
              />
            </aside>
          </div>
        </article>
      </div>
    </section>
  );
}
