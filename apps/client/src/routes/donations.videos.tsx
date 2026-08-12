import { Icons } from "@client/components/icons";
import { SlugEditor } from "@client/components/slug-editor";
import { buttonVariants } from "@client/components/ui/button";
import VideoCard from "@client/components/video-card";
import VideoPriorities from "@client/components/video-priorities";
import { Link, createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Circle, List, Wallet } from "lucide-react";
import { z } from "zod";

import { useUpdateVideoAmountM, useUpdateVideoStatusM, useVideosQ } from "../hooks/api";

export const Route = createFileRoute("/donations/videos")({
  component: VideoQueue,
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
  const updateVideoAmountM = useUpdateVideoAmountM();
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
      counts[video.videoPriorityId] = (counts[video.videoPriorityId] ?? 0) + 1;
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
            : left.donation.createdAt;
      const rightDate =
        activeTab === "watched"
          ? right.watchedAt
          : activeTab === "saved"
            ? right.savedAt
            : right.donation.createdAt;

      return rightDate!.getTime() - leftDate!.getTime() || Number(right.videoId - left.videoId);
    });

  const tabs = [
    {
      id: "all" satisfies typeof activeTab,
      label: "All",
      count: videos.length,
      icon: List,
    },
    {
      id: "notwatched" satisfies typeof activeTab,
      label: "Not watched",
      count: videos.filter((video) => video.watchedAt === null).length,
      icon: Circle,
    },
    {
      id: "watched" satisfies typeof activeTab,
      label: "Watched",
      count: videos.filter((video) => video.watchedAt !== null).length,
      icon: CheckCircle2,
    },
    {
      id: "saved" satisfies typeof activeTab,
      label: "Saved",
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
            <div className="space-y-px p-5" aria-label="Loading video queue">
              <div className="h-16 animate-pulse rounded-lg bg-[#f7f6f9]" />
              <div className="h-16 animate-pulse rounded-lg bg-[#f7f6f9]" />
              <div className="h-16 animate-pulse rounded-lg bg-[#f7f6f9]" />
            </div>
          ) : visibleVideos.length ? (
            <div className="divide-y divide-[#f0eff3]">
              {visibleVideos.map((video) => (
                <VideoCard
                  isUpdating={updateVideoStatusM.isPending || updateVideoAmountM.isPending}
                  key={video.videoId}
                  onAmountChange={(amount) =>
                    updateVideoAmountM.mutateAsync({
                      videoId: video.videoId,
                      amount,
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
                  <Wallet aria-hidden="true" size={20} />
                </div>
                <h3 className="text-sm font-semibold text-[#4c485b]">
                  {videos.length
                    ? activeTab !== "all"
                      ? `No ${tabs.find((tab) => tab.id === activeTab)?.label.toLowerCase()} videos`
                      : "No videos"
                    : "No videos in the queue"}
                </h3>
                <p className="max-w-xs text-xs leading-relaxed text-[#908d9d]">
                  {videos.length
                    ? "Videos matching this filter will appear here."
                    : "Video links from donations will appear here."}
                </p>
              </div>
            </div>
          )}
        </div>

        <aside className="order-1 border-b border-[#efedf3] bg-[#fcfbfd] p-3 lg:order-2 lg:w-72 lg:shrink-0 lg:border-b-0 lg:border-l dark:border-[#302c3b] dark:bg-[#1c1925]">
          <nav className="flex flex-col gap-1" aria-label="Video status filters">
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
