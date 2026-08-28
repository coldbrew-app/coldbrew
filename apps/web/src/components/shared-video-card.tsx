import { getVideoTimeParts, getWatchDurationSeconds } from "@coldbrew/packages/video-timing.js";
import { rurl } from "@lebedevna/readonly-url";
import { fmtAmount, fmtDate, formatRelativeDate } from "@web/lib/fmt";
import { getSharedVideoTimingParts } from "@web/lib/shared-video-timing";
import type { SharedVideo } from "@web/server/exports";

import { useI18n } from "../lib/i18n";
import { Icons } from "./icons";

type Props = {
  showPriorityLabel?: boolean;
  video: SharedVideo;
};

const getYoutubeEmbedUrl = (url: string, startSeconds: number, endSeconds: number) => {
  const parsedUrl = rurl(url);
  const host = parsedUrl.hostname.replace(/^www\./, "").toLowerCase();
  const videoId =
    host === "youtu.be"
      ? parsedUrl.pathname.split("/")[1]
      : (parsedUrl.searchParams.get("v") ??
        parsedUrl.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/)?.[1]);

  if (!videoId) return null;

  return rurl(`https://www.youtube-nocookie.com/embed/${videoId}`).withSearchParams({
    start: startSeconds,
    end: endSeconds,
  }).href;
};

export function SharedVideoCard({ showPriorityLabel = true, video }: Props) {
  const { locale, t } = useI18n();
  const embedUrl = getYoutubeEmbedUrl(video.url, video.startSeconds, video.endSeconds);
  const { startTime, endTime } = getSharedVideoTimingParts(video);
  const timingLabel =
    startTime !== null
      ? endTime !== null
        ? t("videoTimeRange", { startTime, endTime })
        : t("videoFromTime", { startTime })
      : endTime !== null
        ? t("videoUntilTime", { endTime })
        : null;
  const watchDuration = getVideoTimeParts(
    getWatchDurationSeconds(video.startSeconds, video.endSeconds),
  );

  return (
    <article className="group relative flex flex-col gap-3 px-4 py-4 transition-colors hover:bg-secondary/25 sm:px-5">
      <span className="absolute top-8 left-0 h-8 w-1 rounded-r-full bg-primary/55 transition-all group-hover:h-12 group-hover:bg-[#ff647c]" />
      <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-start">
        {embedUrl && (
          <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-muted sm:w-60 sm:shrink-0">
            <iframe
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="size-full"
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
              src={embedUrl}
              title={t("youtubeVideo")}
            />
            {timingLabel !== null && (
              <span className="absolute right-2 bottom-2 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-medium text-white">
                {timingLabel}
              </span>
            )}
          </div>
        )}

        <div className="flex min-w-0 grow flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex min-w-0 grow flex-wrap items-center gap-x-2 gap-y-1">
              <strong className="text-[13px] text-card-foreground">{t("video")}</strong>
              {showPriorityLabel && video.priorityLabel && (
                <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-secondary-foreground">
                  {video.priorityLabel}
                </span>
              )}
              <time
                className="text-[10px] text-muted-foreground"
                dateTime={video.createdAt.toISOString()}
                title={fmtDate(video.createdAt, locale)}
              >
                {formatRelativeDate(video.createdAt, locale)}
              </time>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-0.5">
              {video.displayAmount !== null && video.displayCurrency !== null && (
                <strong className="text-[13px] text-card-foreground">
                  {fmtAmount(video.displayAmount, video.displayCurrency, locale)}
                </strong>
              )}
              <span className="text-xs text-muted-foreground">
                {t("watchDuration", watchDuration)}
              </span>
            </div>
          </div>

          <a
            className="inline-flex w-fit items-center gap-1 text-xs font-semibold text-primary hover:underline"
            href={video.url}
            rel="noreferrer"
            target="_blank"
          >
            <Icons.externalLink aria-hidden="true" size={13} />
            {t("openOnYoutube")}
          </a>

          {video.watchedAt && (
            <time
              className="text-[10px] text-muted-foreground"
              dateTime={video.watchedAt.toISOString()}
              title={fmtDate(video.watchedAt, locale)}
            >
              {t("watchedOn", { date: fmtDate(video.watchedAt, locale) })}
            </time>
          )}
        </div>
      </div>
    </article>
  );
}
