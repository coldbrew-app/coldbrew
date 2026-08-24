import { CurrencyCodeSchema, MoneyAmountSchema } from "@coldbrew/packages/schemas.js";
import {
  formatVideoTime,
  getWatchDurationSeconds,
  parseVideoTime,
} from "@coldbrew/packages/video-timing.js";
import { fmtAmount, fmtDate, formatRelativeDate } from "@web/lib/fmt";
import type { Video } from "@web/server/exports";
import { clsx } from "clsx";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { useTextWithLinks } from "../hooks/use-text-with-links";
import { useI18n } from "../lib/i18n";
import { Icons } from "./icons";
import { Button } from "./ui/button";

type Props = {
  video: Video;
  showSource?: boolean;
  onStatusChange?: (status: { watchedAt?: Date | null; savedAt?: Date | null }) => void;
  onUpdate?: (input: { amount: string; startSeconds: number; endSeconds: number }) => Promise<void>;
  isUpdating?: boolean;
};

type VideoFormValues = {
  amount: string;
  startTime: string;
  endTime: string;
};

const getYoutubeEmbedUrl = (url: string, startSeconds: number, endSeconds: number) => {
  const parsedUrl = new URL(url);
  const host = parsedUrl.hostname.replace(/^www\./, "").toLowerCase();
  const videoId =
    host === "youtu.be"
      ? parsedUrl.pathname.split("/")[1]
      : (parsedUrl.searchParams.get("v") ??
        parsedUrl.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/)?.[1]);

  if (!videoId) return null;

  const embedUrl = new URL(`https://www.youtube-nocookie.com/embed/${videoId}`);
  embedUrl.searchParams.set("start", String(startSeconds));
  embedUrl.searchParams.set("end", String(endSeconds));
  return embedUrl.href;
};

const normalizeUrl = (url: string) => {
  const parsedUrl = new URL(url.startsWith("www.") ? `https://${url}` : url);
  const pathname = parsedUrl.pathname.replace(/\/$/, "");

  return `${parsedUrl.hostname.toLowerCase()}${pathname}${parsedUrl.search}`;
};

export default function VideoCard({
  video,
  showSource = false,
  onStatusChange,
  onUpdate,
  isUpdating = false,
}: Props) {
  const { locale, t } = useI18n();
  const author =
    video.source === "donation" ? (video.donation.author ?? t("anonymous")) : t("video");
  const messageChunks = useTextWithLinks(
    video.source === "donation" ? (video.donation.message ?? "") : "",
  );
  const embedUrl = getYoutubeEmbedUrl(video.url, video.startSeconds, video.endSeconds);
  const timingLabel = `${formatVideoTime(video.startSeconds)}–${formatVideoTime(video.endSeconds)}`;
  const watchDuration = formatVideoTime(
    getWatchDurationSeconds(video.startSeconds, video.endSeconds),
  );
  const isWatched = video.watchedAt !== null;
  const isSaved = video.savedAt !== null;
  const SourceIcon = video.source === "donation" ? Icons.videoFromDonation : Icons.manualVideo;
  const displayedAmount =
    video.queueAmount === null && video.source === "donation"
      ? video.donation.amount
      : (video.queueAmount ?? MoneyAmountSchema.parse("0.00"));
  const displayedCurrency =
    video.queueAmount === null && video.source === "donation"
      ? video.donation.currency
      : CurrencyCodeSchema.parse(video.queueCurrency);
  const amountHelpId = `video-amount-help-${video.videoId}`;
  const timingHelpId = `video-timing-help-${video.videoId}`;
  const [isEditing, setIsEditing] = useState(false);
  const { formState, getValues, handleSubmit, register, reset, trigger, watch } =
    useForm<VideoFormValues>({
      defaultValues: {
        amount: video.queueAmount ?? "0.00",
        startTime: formatVideoTime(video.startSeconds),
        endTime: formatVideoTime(video.endSeconds),
      },
      mode: "onChange",
    });
  const editedStartSeconds = parseVideoTime(watch("startTime"));
  const editedEndSeconds = parseVideoTime(watch("endTime"));
  const editedWatchDuration =
    editedStartSeconds !== null &&
    editedEndSeconds !== null &&
    editedEndSeconds > editedStartSeconds
      ? formatVideoTime(getWatchDurationSeconds(editedStartSeconds, editedEndSeconds))
      : null;

  const startEditing = () => {
    reset({
      amount: video.queueAmount ?? "0.00",
      startTime: formatVideoTime(video.startSeconds),
      endTime: formatVideoTime(video.endSeconds),
    });
    setIsEditing(true);
  };

  const cancelEditing = () => {
    reset({
      amount: video.queueAmount ?? "0.00",
      startTime: formatVideoTime(video.startSeconds),
      endTime: formatVideoTime(video.endSeconds),
    });
    setIsEditing(false);
  };

  const save = async (input: VideoFormValues) => {
    if (!onUpdate) return;
    const startSeconds = parseVideoTime(input.startTime);
    const endSeconds = parseVideoTime(input.endTime);
    if (startSeconds === null || endSeconds === null || endSeconds <= startSeconds) return;

    await onUpdate({ amount: input.amount, startSeconds, endSeconds });
    setIsEditing(false);
  };

  return (
    <article className="group relative flex flex-col gap-3 px-4 py-4 transition-colors hover:bg-secondary/25 sm:px-5">
      <span className="absolute top-8 left-0 h-8 w-1 rounded-r-full bg-primary/55 transition-all group-hover:h-12 group-hover:bg-[#ff647c]" />
      <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-start">
        <div className="flex flex-col gap-3 sm:shrink-0">
          {embedUrl && (
            <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-muted sm:w-60">
              <iframe
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="size-full"
                loading="lazy"
                referrerPolicy="strict-origin-when-cross-origin"
                src={embedUrl}
                title={
                  video.source === "donation"
                    ? t("youtubeVideoFrom", { author })
                    : t("youtubeVideo")
                }
              />
              <span className="absolute right-2 bottom-2 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-medium text-white">
                {timingLabel}
              </span>
            </div>
          )}
        </div>

        <div className="flex min-w-0 grow flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex min-w-0 grow items-center gap-3">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <strong className="text-[13px] text-card-foreground">{author}</strong>
                {showSource && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background/70 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                    <SourceIcon aria-hidden="true" size={12} />
                    {t(video.source === "donation" ? "fromDonation" : "addedManually")}
                  </span>
                )}
                {video.priorityLabel && (
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-secondary-foreground">
                    {video.priorityLabel}
                  </span>
                )}
              </div>
              <time
                className="block text-[10px] text-muted-foreground"
                dateTime={video.createdAt.toISOString()}
                title={fmtDate(video.createdAt, locale)}
              >
                {formatRelativeDate(video.createdAt, locale)}
              </time>
            </div>

            <div className="flex shrink-0 items-start gap-2">
              <div className="flex flex-col items-end gap-0.5">
                <strong className="block text-[13px] text-card-foreground">
                  {fmtAmount(displayedAmount, displayedCurrency, locale)}
                </strong>
                {!isEditing && (
                  <span className="text-xs text-muted-foreground">
                    {t("watchDuration", { duration: watchDuration })}
                  </span>
                )}
              </div>
              {onUpdate && !isEditing && (
                <Button
                  aria-label={t("editVideoDetails")}
                  disabled={isUpdating}
                  onClick={startEditing}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                >
                  <Icons.edit aria-hidden="true" />
                </Button>
              )}
            </div>
          </div>
          {isEditing && (
            <form
              className="flex flex-col gap-3 rounded-lg border border-border bg-muted/60 p-3"
              onSubmit={(event) => void handleSubmit(save)(event)}
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-foreground">{t("amount")}</span>
                  <input
                    aria-describedby={amountHelpId}
                    aria-invalid={Boolean(formState.errors.amount)}
                    autoComplete="off"
                    className="h-8 w-full rounded-md border border-input bg-card px-2 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                    disabled={isUpdating}
                    min="0"
                    step="any"
                    type="number"
                    {...register("amount", {
                      required: t("enterPriorityAmount"),
                      validate: (value) =>
                        MoneyAmountSchema.safeParse(value).success || t("enterAmountZeroOrMore"),
                    })}
                  />
                  <span
                    className="text-[11px] leading-snug text-muted-foreground"
                    id={amountHelpId}
                  >
                    {t("queueAmountHelp")}
                  </span>
                  {formState.errors.amount && (
                    <span className="text-[11px] text-red-600">
                      {formState.errors.amount.message}
                    </span>
                  )}
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-foreground">{t("videoStart")}</span>
                  <input
                    aria-describedby={timingHelpId}
                    aria-invalid={Boolean(formState.errors.startTime)}
                    autoComplete="off"
                    className="h-8 w-full rounded-md border border-input bg-card px-2 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                    disabled={isUpdating}
                    inputMode="numeric"
                    placeholder="0:00"
                    type="text"
                    {...register("startTime", {
                      required: t("enterVideoTime"),
                      validate: (value) => parseVideoTime(value) !== null || t("invalidVideoTime"),
                      onChange: () => void trigger("endTime"),
                    })}
                  />
                  {formState.errors.startTime && (
                    <span className="text-[11px] text-red-600">
                      {formState.errors.startTime.message}
                    </span>
                  )}
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-foreground">{t("videoEnd")}</span>
                  <input
                    aria-describedby={timingHelpId}
                    aria-invalid={Boolean(formState.errors.endTime)}
                    autoComplete="off"
                    className="h-8 w-full rounded-md border border-input bg-card px-2 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                    disabled={isUpdating}
                    inputMode="numeric"
                    placeholder="0:00"
                    type="text"
                    {...register("endTime", {
                      required: t("enterVideoTime"),
                      validate: (value) => {
                        const endSeconds = parseVideoTime(value);
                        if (endSeconds === null) return t("invalidVideoTime");
                        const startSeconds = parseVideoTime(getValues("startTime"));
                        return (
                          startSeconds === null ||
                          endSeconds > startSeconds ||
                          t("videoEndAfterStart")
                        );
                      },
                    })}
                  />
                  {formState.errors.endTime && (
                    <span className="text-[11px] text-red-600">
                      {formState.errors.endTime.message}
                    </span>
                  )}
                </label>
              </div>
              <span className="text-[11px] leading-snug text-muted-foreground" id={timingHelpId}>
                {editedWatchDuration === null
                  ? t("videoTimingHelp")
                  : t("watchDuration", { duration: editedWatchDuration })}
              </span>
              <div className="flex items-center justify-end gap-2">
                <Button
                  disabled={isUpdating}
                  onClick={cancelEditing}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Icons.cancel aria-hidden="true" />
                  {t("cancelEditing")}
                </Button>
                <Button disabled={!formState.isValid || isUpdating} size="sm" type="submit">
                  <Icons.submit aria-hidden="true" />
                  {t("save")}
                </Button>
              </div>
            </form>
          )}
          {video.source === "donation" ? (
            <p className="min-w-0 grow text-xs leading-relaxed text-muted-foreground sm:py-1">
              {messageChunks.map((chunk, index) => {
                if (chunk.type === "string") {
                  return <span key={index}>{chunk.value}</span>;
                }

                const isVideoLink = normalizeUrl(chunk.href) === normalizeUrl(video.url);

                return (
                  <a
                    className={
                      isVideoLink
                        ? "rounded bg-secondary px-1 py-0.5 font-semibold text-secondary-foreground hover:bg-accent"
                        : "font-semibold text-primary hover:underline"
                    }
                    href={chunk.href}
                    key={index}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {chunk.text}
                  </a>
                );
              })}
            </p>
          ) : (
            <a
              className="inline-flex w-fit items-center gap-1 text-xs font-semibold text-primary hover:underline"
              href={video.url}
              rel="noreferrer"
              target="_blank"
            >
              <Icons.externalLink aria-hidden="true" size={13} />
              {t("openOnYoutube")}
            </a>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {onStatusChange && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  aria-label={t(isWatched ? "markVideoNotWatched" : "markVideoWatched")}
                  className={clsx(isWatched && "bg-green-100 text-green-700 hover:bg-green-200")}
                  disabled={isUpdating}
                  onClick={() => onStatusChange({ watchedAt: isWatched ? null : new Date() })}
                  size="sm"
                  variant={isWatched ? "secondary" : "outline"}
                >
                  {isWatched ? (
                    <Icons.watched aria-hidden="true" />
                  ) : (
                    <Icons.notWatched aria-hidden="true" />
                  )}
                  {t("watched")}
                </Button>
                <Button
                  aria-label={t(isSaved ? "removeVideoSaved" : "saveVideo")}
                  disabled={isUpdating}
                  onClick={() => onStatusChange({ savedAt: isSaved ? null : new Date() })}
                  size="sm"
                  variant={isSaved ? "secondary" : "outline"}
                >
                  <Icons.bookmark aria-hidden="true" fill={isSaved ? "currentColor" : "none"} />
                  {t("saved")}
                </Button>
              </div>
            )}

            {(video.watchedAt || video.savedAt) && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                {video.watchedAt && (
                  <time
                    dateTime={video.watchedAt.toISOString()}
                    title={fmtDate(video.watchedAt, locale)}
                  >
                    {t("watchedOn", { date: fmtDate(video.watchedAt, locale) })}
                  </time>
                )}
                {video.savedAt && (
                  <time
                    dateTime={video.savedAt.toISOString()}
                    title={fmtDate(video.savedAt, locale)}
                  >
                    {t("savedOn", { date: fmtDate(video.savedAt, locale) })}
                  </time>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
