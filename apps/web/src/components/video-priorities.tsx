import { Link } from "@tanstack/react-router";
import { VideoPrioritiesSkeleton } from "@web/components/loading-skeletons";
import QueryErrorState from "@web/components/query-error-state";
import { useVideoPrioritiesQ } from "@web/hooks/api";
import { cn } from "@web/lib/utils";

import { createI18n, useI18n } from "../lib/i18n";
import VideoPriorityEditor from "./video-priority-editor";

const i18n = createI18n({
  all: {
    en: "All",
    ru: "Все",
  },
  queues: {
    en: "Priorities",
    ru: "Приоритеты",
  },
  minimumDonation: {
    en: "Shared across queues · minimum amount per video minute.",
    ru: "Едины для всех очередей · минимальная сумма за минуту просмотра.",
  },
  loadingVideoPriorities: {
    en: "Loading video priorities",
    ru: "Загружаем приоритеты…",
  },
  noQueuesYet: {
    en: "No priorities yet.",
    ru: "Приоритеты пока не настроены.",
  },
  videoUnassigned: {
    en: "Without priority",
    ru: "Без приоритета",
  },
});

type Props = {
  videoQueueId?: number;
  selectedVideoPriorityId: number | "unassigned" | null;
  remainingSecondsByPriorityId: Record<number, number>;
  videoCountByPriorityId: Record<number, number>;
};

export default function VideoPriorities({
  videoQueueId,
  selectedVideoPriorityId,
  remainingSecondsByPriorityId,
  videoCountByPriorityId,
}: Props) {
  const { t } = useI18n(i18n);
  const prioritiesQ = useVideoPrioritiesQ();
  const videoCount = Object.values(videoCountByPriorityId).reduce(
    (total, count) => total + count,
    0,
  );

  return (
    <section className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
      <div className="flex flex-col gap-0.5 px-1">
        <h2 className="text-xs font-semibold text-card-foreground">{t("queues")}</h2>
        <p className="text-[10px] text-muted-foreground">{t("minimumDonation")}</p>
      </div>
      <Link
        aria-current={selectedVideoPriorityId === null ? "page" : undefined}
        className={cn(
          "flex rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
          selectedVideoPriorityId === null
            ? "border-ring/35 bg-secondary text-secondary-foreground hover:bg-accent"
            : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
        search={(previous) => ({
          videoQueueId,
          page: 1,
          videoPriorityId: "all",
          videoStatus: previous.videoStatus ?? "all",
        })}
        to="/videos"
      >
        <span className="grow">{t("all")}</span>
        <span className="text-[10px] font-bold">{videoCount}</span>
      </Link>

      <Link
        aria-current={selectedVideoPriorityId === "unassigned" ? "page" : undefined}
        className={cn(
          "flex rounded-lg border px-3 py-2 text-xs font-medium",
          selectedVideoPriorityId === "unassigned"
            ? "border-ring/35 bg-secondary text-secondary-foreground"
            : "border-border bg-card text-muted-foreground",
        )}
        to="/videos"
        search={(previous) => ({
          videoQueueId,
          page: 1,
          videoPriorityId: "unassigned",
          videoStatus: previous.videoStatus ?? "all",
        })}
      >
        <span className="grow">{t("videoUnassigned")}</span>
        <span>{videoCountByPriorityId[0] ?? 0}</span>
      </Link>

      {prioritiesQ.isLoading ? (
        <VideoPrioritiesSkeleton aria-busy="true" aria-label={t("loadingVideoPriorities")} />
      ) : prioritiesQ.isError ? (
        <QueryErrorState
          className="min-h-28 p-2"
          isRetrying={prioritiesQ.isFetching}
          onRetry={() => void prioritiesQ.refetch()}
        />
      ) : prioritiesQ.data?.length ? (
        prioritiesQ.data.map((priority) => (
          <VideoPriorityEditor
            videoQueueId={videoQueueId}
            isSelected={priority.videoPriorityId === selectedVideoPriorityId}
            key={priority.videoPriorityId}
            priority={priority}
            remainingSeconds={remainingSecondsByPriorityId[priority.videoPriorityId] ?? 0}
            videoCount={videoCountByPriorityId[priority.videoPriorityId] ?? 0}
          />
        ))
      ) : (
        <p className="px-1 text-xs text-muted-foreground">{t("noQueuesYet")}</p>
      )}
    </section>
  );
}
