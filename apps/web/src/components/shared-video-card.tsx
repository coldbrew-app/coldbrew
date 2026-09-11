import {
  getRoundedWatchDurationParts,
  getWatchDurationSeconds,
} from "@coldbrew/packages/video-timing.js";
import { rurl } from "@lebedevna/readonly-url";
import { fmtAmount, fmtDate, fmtListDate } from "@web/lib/fmt";
import { getSharedVideoTimingParts } from "@web/lib/shared-video-timing";
import type { SharedVideo } from "@web/server/exports";

import { createI18n, useI18n } from "../lib/i18n";

type HourMinuteParts = {
  hours: number;
  minutes: number;
};

const i18n = createI18n({
  openYoutubeVideo: {
    en: "Open YouTube video in a new tab",
    ru: "Открыть видео YouTube в новой вкладке",
  },
  videoDurationPending: {
    en: "Fetching duration",
    ru: "Длительность уточняется",
  },
  videoDurationUnavailable: {
    en: "Duration unavailable",
    ru: "Не удалось получить длительность",
  },
  videoFromTime: {
    en: ({ startTime }: { startTime: string }) => `From ${startTime}`,
    ru: ({ startTime }: { startTime: string }) => `С ${startTime}`,
  },
  videoUntilTime: {
    en: ({ endTime }: { endTime: string }) => `Until ${endTime}`,
    ru: ({ endTime }: { endTime: string }) => `До ${endTime}`,
  },
  videoTimeRange: {
    en: ({ startTime, endTime }: { startTime: string; endTime: string }) =>
      `From ${startTime} until ${endTime}`,
    ru: ({ startTime, endTime }: { startTime: string; endTime: string }) =>
      `С ${startTime} до ${endTime}`,
  },
  watchDuration: {
    en: ({ hours, minutes }: HourMinuteParts) =>
      `Watch time: ${hours > 0 ? `${hours} hr ` : ""}${minutes} min`,
    ru: ({ hours, minutes }: HourMinuteParts) =>
      `Время просмотра: ${hours > 0 ? `${hours} ч ` : ""}${minutes} мин`,
  },
  watchedOn: {
    en: ({ date }: { date: string }) => `Watched ${date}`,
    ru: ({ date }: { date: string }) => `Просмотрено: ${date}`,
  },
});

type Props = {
  showPriorityLabel?: boolean;
  video: SharedVideo;
};

const getYoutubeVideoId = (url: string) => {
  const parsedUrl = rurl(url);
  const host = parsedUrl.hostname.replace(/^www\./, "").toLowerCase();
  return host === "youtu.be"
    ? parsedUrl.pathname.split("/")[1]
    : (parsedUrl.searchParams.get("v") ??
        parsedUrl.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/)?.[1] ??
        null);
};

const getYoutubeThumbnailUrl = (videoId: string) =>
  `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;

export function SharedVideoCard({ showPriorityLabel = true, video }: Props) {
  const { locale, t } = useI18n(i18n);
  const youtubeVideoId = getYoutubeVideoId(video.url);
  const { startTime, endTime } = getSharedVideoTimingParts(video);
  const timingLabel =
    startTime !== null
      ? endTime !== null
        ? t("videoTimeRange", { startTime, endTime })
        : t("videoFromTime", { startTime })
      : endTime !== null
        ? t("videoUntilTime", { endTime })
        : null;
  const watchDuration =
    video.endSeconds === null
      ? null
      : getRoundedWatchDurationParts(getWatchDurationSeconds(video.startSeconds, video.endSeconds));

  return (
    <article className="relative flex min-w-0 flex-col gap-4 px-4 py-5 sm:px-5">
      <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-start">
        {youtubeVideoId !== null && (
          <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-muted sm:w-60 sm:shrink-0">
            <a
              aria-label={t("openYoutubeVideo")}
              className="group absolute inset-0 outline-none focus-visible:ring-3 focus-visible:ring-ring/70 focus-visible:ring-inset"
              href={video.url}
              rel="noreferrer"
              target="_blank"
            >
              <img
                alt=""
                className="size-full object-cover"
                draggable={false}
                loading="lazy"
                src={getYoutubeThumbnailUrl(youtubeVideoId)}
              />
              <span
                aria-hidden="true"
                className="absolute inset-0 bg-black/10 transition-colors group-hover:bg-black/20"
              />
            </a>
            {timingLabel !== null && (
              <span className="pointer-events-none absolute right-2 bottom-2 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-medium text-white">
                {timingLabel}
              </span>
            )}
          </div>
        )}

        <div className="flex min-w-0 grow flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex min-w-0 grow flex-wrap items-center gap-x-2 gap-y-1">
              {video.title !== null && (
                <h3 className="min-w-0 text-sm font-semibold wrap-anywhere text-card-foreground">
                  {video.title}
                </h3>
              )}
              {showPriorityLabel && video.priorityLabel !== null && (
                <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-secondary-foreground">
                  {video.priorityLabel}
                </span>
              )}
              <time
                className="text-xs text-muted-foreground"
                dateTime={video.createdAt.toISOString()}
                title={fmtDate(video.createdAt, locale)}
              >
                {fmtListDate(video.createdAt, locale)}
              </time>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-0.5">
              {video.displayAmount !== null && video.displayCurrency !== null && (
                <strong className="text-sm text-card-foreground">
                  {fmtAmount(video.displayAmount, video.displayCurrency, locale)}
                </strong>
              )}
              <span className="text-xs text-muted-foreground">
                {watchDuration === null
                  ? t(
                      video.metadataUnavailable
                        ? "videoDurationUnavailable"
                        : "videoDurationPending",
                    )
                  : t("watchDuration", watchDuration)}
              </span>
            </div>
          </div>

          {video.watchedAt && (
            <time
              className="text-xs text-muted-foreground"
              dateTime={video.watchedAt.toISOString()}
              title={fmtDate(video.watchedAt, locale)}
            >
              {t("watchedOn", { date: fmtListDate(video.watchedAt, locale) })}
            </time>
          )}
        </div>
      </div>
    </article>
  );
}
