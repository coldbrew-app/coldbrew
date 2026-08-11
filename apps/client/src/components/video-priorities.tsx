import { useVideoPrioritiesQ } from "@client/hooks/api";
import { cn } from "@client/lib/utils";
import { Link } from "@tanstack/react-router";

import VideoPriorityEditor from "./video-priority-editor";

type Props = {
  selectedVideoPriorityId: number | null;
  videoCountByPriorityId: Record<number, number>;
};

export default function VideoPriorities({
  selectedVideoPriorityId,
  videoCountByPriorityId,
}: Props) {
  const prioritiesQ = useVideoPrioritiesQ();
  const videoCount = Object.values(videoCountByPriorityId).reduce((total, count) => total + count, 0);

  return (
    <section className="mt-3 flex flex-col gap-2 border-t border-[#efedf3] pt-3 dark:border-[#302c3b]">
      <div className="flex flex-col gap-0.5 px-1">
        <h2 className="text-xs font-semibold text-[#4c485b] dark:text-[#e4dfed]">Queues</h2>
        <p className="text-[10px] text-[#908d9d]">Minimum donation amount per video minute.</p>
      </div>
      <Link
        aria-current={selectedVideoPriorityId === null ? "page" : undefined}
        className={cn(
          "flex rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
          selectedVideoPriorityId === null
            ? "border-violet-200 bg-violet-100 text-violet-800 hover:bg-violet-200 dark:border-violet-400/40 dark:bg-violet-400/20 dark:text-violet-100 dark:hover:bg-violet-400/30"
            : "border-[#e5e3ea] bg-white text-[#595565] hover:bg-[#f3f1f6] dark:border-[#393442] dark:bg-[#24202d] dark:text-[#c9c3d4] dark:hover:bg-[#2b2735] dark:hover:text-white",
        )}
        search={(previous) => ({
          videoPriorityId: "all",
          videoStatus: previous.videoStatus ?? "all",
        })}
        to="/donations/videos"
      >
        <span className="grow">All</span>
        <span className="text-[10px] font-bold">{videoCount}</span>
      </Link>

      {prioritiesQ.isLoading ? (
        <div className="flex flex-col gap-2" aria-label="Loading video priorities">
          <div className="h-20 animate-pulse rounded-lg bg-[#f0eff3] dark:bg-[#302c3b]" />
          <div className="h-20 animate-pulse rounded-lg bg-[#f0eff3] dark:bg-[#302c3b]" />
        </div>
      ) : prioritiesQ.data?.length ? (
        prioritiesQ.data.map((priority) => (
          <VideoPriorityEditor
            isSelected={priority.videoPriorityId === selectedVideoPriorityId}
            key={priority.videoPriorityId}
            priority={priority}
            videoCount={videoCountByPriorityId[priority.videoPriorityId] ?? 0}
          />
        ))
      ) : (
        <p className="px-1 text-xs text-[#908d9d]">No queues yet.</p>
      )}

      {prioritiesQ.error && (
        <p className="px-1 text-xs text-red-600" role="alert">
          {prioritiesQ.error.message}
        </p>
      )}
    </section>
  );
}
