import { Link, createFileRoute } from "@tanstack/react-router";
import { Icons } from "@web/components/icons";
import { VideoListSkeleton } from "@web/components/loading-skeletons";
import { SlugEditor } from "@web/components/slug-editor";
import { buttonVariants } from "@web/components/ui/button";
import VideoCard from "@web/components/video-card";
import VideoPriorities from "@web/components/video-priorities";
import { z } from "zod";

import { useUpdateVideoM, useUpdateVideoStatusM, useVideosQ } from "../../hooks/api";
import { createTranslator, useI18n } from "../../lib/i18n";

export const Route = createFileRoute("/_authenticated/donations/videos")({
  component: VideoQueue,
  head: ({ match }) => ({
    meta: [{ title: `${createTranslator(match.context.locale)("videoQueue")} · Coldbrew` }],
  }),
  loader: async ({ context }) => {
    if (!context.viewer) return;
    await Promise.all([
      context.queryClient.ensureQueryData(context.trpc.videos.queryOptions()),
      context.queryClient.ensureQueryData(context.trpc.videoPriorities.queryOptions()),
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
            : left.donation.occurredAt;
      const rightDate =
        activeTab === "watched"
          ? right.watchedAt
          : activeTab === "saved"
            ? right.savedAt
            : right.donation.occurredAt;

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
    <div>
      <SlugEditor />
      <div className="flex flex-col lg:flex-row">
        <div className="order-2 min-w-0 grow lg:order-1">
          {videosQ.isLoading ? (
            <VideoListSkeleton aria-busy="true" aria-label={t("loadingVideoQueue")} withActions />
          ) : visibleVideos.length ? (
            <div className="divide-y divide-[#f0eff3]">
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
                  video={video}
                />
              ))}
            </div>
          ) : (
            <div className="grid min-h-64 place-items-center px-5 text-center">
              <div className="flex flex-col items-center gap-2">
                <div className="grid size-11 place-items-center rounded-xl bg-violet-100 text-violet-600">
                  <Icons.wallet aria-hidden="true" size={20} />
                </div>
                <h3 className="text-sm font-semibold text-[#4c485b]">
                  {videos.length
                    ? activeTab !== "all"
                      ? t("noFilteredVideos", {
                          status:
                            tabs.find((tab) => tab.id === activeTab)?.label.toLowerCase() ?? "",
                        })
                      : t("noVideos")
                    : t("noVideosInQueue")}
                </h3>
                <p className="max-w-xs text-xs leading-relaxed text-[#908d9d]">
                  {videos.length ? t("filteredVideosWillAppear") : t("videoLinksWillAppear")}
                </p>
              </div>
            </div>
          )}
        </div>

        <aside className="order-1 border-b border-[#efedf3] bg-[#fcfbfd] p-3 lg:order-2 lg:w-72 lg:shrink-0 lg:border-b-0 lg:border-l dark:border-[#302c3b] dark:bg-[#1c1925]">
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
                  to="/donations/videos"
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
    </div>
  );
}
