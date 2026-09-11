import { CurrencyCodeSchema, MoneyAmountSchema } from "@coldbrew/packages/schemas.js";
import {
  formatVideoTime,
  getRoundedWatchDurationParts,
  getWatchDurationSeconds,
} from "@coldbrew/packages/video-timing.js";
import { rurl } from "@lebedevna/readonly-url";
import { Link } from "@tanstack/react-router";
import { fmtAmount, fmtDate, fmtListDate, formatMoneyInputValue } from "@web/lib/fmt";
import type { Video } from "@web/server/exports";
import { clsx } from "clsx";
import { useState, type ReactNode } from "react";
import { FormProvider, useForm } from "react-hook-form";

import { useTextWithLinks } from "../hooks/use-text-with-links";
import { createI18n, useI18n } from "../lib/i18n";
import { Icons } from "./icons";
import { Button } from "./ui/button";
import { Field, FieldError, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { parseVideoTiming, VideoTimingFields, type VideoTimingValues } from "./video-timing-fields";

type HourMinuteParts = {
  hours: number;
  minutes: number;
};

const i18n = createI18n({
  queueAmountUnavailable: {
    en: "not calculated",
    ru: "не рассчитана",
  },
  goToDonation: {
    en: "Open original donation",
    ru: "Открыть исходный донат",
  },
  watched: {
    en: "Watched",
    ru: "Просмотрено",
  },
  bookmarked: {
    en: "Bookmarked",
    ru: "В закладках",
  },
  cancelEditing: {
    en: "Cancel editing",
    ru: "Отменить",
  },
  enterAmountZeroOrMore: {
    en: "Enter an amount of zero or more.",
    ru: "Укажите число не меньше нуля.",
  },
  save: {
    en: "Save",
    ru: "Сохранить",
  },
  anonymous: {
    en: "Anonymous",
    ru: "Аноним",
  },
  video: {
    en: "Video",
    ru: "Видео",
  },
  openYoutubeVideoFrom: {
    en: ({ author }: { author: string }) => `Open YouTube video from ${author} in a new tab`,
    ru: ({ author }: { author: string }) => `Открыть видео YouTube от ${author} в новой вкладке`,
  },
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
  videoUnassigned: {
    en: "Without priority",
    ru: "Без приоритета",
  },
  videoRetryMetadata: {
    en: "Retry metadata",
    ru: "Повторить получение данных",
  },
  videoInvalidRange: {
    en: "Check video boundaries",
    ru: "Проверьте границы видео",
  },
  videoNextRetry: {
    en: ({ date }: { date: string }) => `Next attempt: ${date}`,
    ru: ({ date }: { date: string }) => `Следующая попытка: ${date}`,
  },
  addedManually: {
    en: "Added manually",
    ru: "Добавлено вручную",
  },
  openOnYoutube: {
    en: "Open on YouTube",
    ru: "Открыть на YouTube",
  },
  editVideoDetails: {
    en: "Edit video details",
    ru: "Изменить видео",
  },
  amount: {
    en: "Amount",
    ru: "Сумма",
  },
  videoFromTime: {
    en: ({ startTime }: { startTime: string }) => `From ${startTime}`,
    ru: ({ startTime }: { startTime: string }) => `С ${startTime}`,
  },
  watchDuration: {
    en: ({ hours, minutes }: HourMinuteParts) =>
      `Watch time: ${hours > 0 ? `${hours} hr ` : ""}${minutes} min`,
    ru: ({ hours, minutes }: HourMinuteParts) =>
      `Время просмотра: ${hours > 0 ? `${hours} ч ` : ""}${minutes} мин`,
  },
  enterPriorityAmount: {
    en: "Enter a priority amount.",
    ru: "Укажите сумму для очереди.",
  },
  markVideoWatched: {
    en: "Mark video as watched",
    ru: "Отметить видео просмотренным",
  },
  markVideoNotWatched: {
    en: "Mark video as not watched",
    ru: "Снять отметку о просмотре",
  },
  bookmarkVideo: {
    en: "Bookmark video",
    ru: "Добавить видео в закладки",
  },
  removeVideoBookmark: {
    en: "Remove video bookmark",
    ru: "Убрать видео из закладок",
  },
  watchedOn: {
    en: ({ date }: { date: string }) => `Watched ${date}`,
    ru: ({ date }: { date: string }) => `Просмотрено: ${date}`,
  },
});

type Props = {
  queueControl?: ReactNode;
  video: Video;
  showPriorityLabel?: boolean;
  showSource?: boolean;
  onStatusChange?: (status: { watchedAt?: Date | null; bookmarkedAt?: Date | null }) => void;
  onUpdate?: (input: {
    amount: string;
    startSeconds: number;
    endSeconds: number | null;
  }) => Promise<void>;
  isUpdating?: boolean;
  onRetryMetadata?: () => void;
};

type VideoFormValues = VideoTimingValues & {
  amount: string;
};

const getYoutubeThumbnailUrl = (videoId: string) =>
  `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;

const normalizeUrl = (url: string) => {
  const parsedUrl = rurl(url.startsWith("www.") ? `https://${url}` : url);
  const pathname = parsedUrl.pathname.replace(/\/$/, "");

  return `${parsedUrl.hostname.toLowerCase()}${pathname}${parsedUrl.search}`;
};

export default function VideoCard({
  queueControl,
  video,
  showPriorityLabel = true,
  showSource = false,
  onStatusChange,
  onUpdate,
  isUpdating = false,
  onRetryMetadata,
}: Props) {
  const { locale, t } = useI18n(i18n);
  const author =
    video.source === "donation" ? (video.donation.author ?? t("anonymous")) : t("video");
  const messageChunks = useTextWithLinks(
    video.source === "donation" ? (video.donation.message ?? "") : "",
  );
  const timingLabel =
    video.endSeconds === null
      ? t("videoFromTime", { startTime: formatVideoTime(video.startSeconds) })
      : `${formatVideoTime(video.startSeconds)}–${formatVideoTime(video.endSeconds)}`;
  const watchDuration =
    video.endSeconds === null
      ? null
      : getRoundedWatchDurationParts(getWatchDurationSeconds(video.startSeconds, video.endSeconds));
  const isWatched = video.watchedAt !== null;
  const isBookmarked = video.bookmarkedAt !== null;
  const amountErrorId = `video-amount-error-${video.videoId}`;
  const [isEditing, setIsEditing] = useState(false);
  const form = useForm<VideoFormValues>({
    defaultValues: {
      amount: formatMoneyInputValue(video.queueAmount ?? MoneyAmountSchema.parse("0.00")),
      startTime: formatVideoTime(video.startSeconds),
      endTime: video.endSeconds === null ? "" : formatVideoTime(video.endSeconds),
    },
    mode: "onChange",
  });
  const { formState, handleSubmit, register, reset } = form;

  const startEditing = () => {
    reset({
      amount: formatMoneyInputValue(video.queueAmount ?? MoneyAmountSchema.parse("0.00")),
      startTime: formatVideoTime(video.startSeconds),
      endTime: video.endSeconds === null ? "" : formatVideoTime(video.endSeconds),
    });
    setIsEditing(true);
  };

  const cancelEditing = () => {
    reset({
      amount: formatMoneyInputValue(video.queueAmount ?? MoneyAmountSchema.parse("0.00")),
      startTime: formatVideoTime(video.startSeconds),
      endTime: video.endSeconds === null ? "" : formatVideoTime(video.endSeconds),
    });
    setIsEditing(false);
  };

  const save = async (input: VideoFormValues) => {
    if (!onUpdate) {
      return;
    }
    const timing = parseVideoTiming(input, {
      allowOpenEnd: true,
      maximumEndSeconds: video.durationSeconds,
    });
    if (timing === null) {
      return;
    }

    await onUpdate({
      amount: input.amount,
      ...timing,
      endSeconds: timing.endSeconds,
    });
    setIsEditing(false);
  };

  return (
    <article className="@container relative min-w-0 px-4 py-4 sm:px-5">
      <div className="grid min-w-0 items-start gap-5 @3xl:grid-cols-[clamp(19rem,33%,25rem)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-muted">
            <a
              aria-label={
                video.source === "donation"
                  ? t("openYoutubeVideoFrom", { author })
                  : t("openYoutubeVideo")
              }
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
                src={getYoutubeThumbnailUrl(video.providerVideoId)}
              />
              <span
                aria-hidden="true"
                className="absolute inset-0 bg-black/10 transition-colors group-hover:bg-black/20"
              />
            </a>
            <span className="pointer-events-none absolute right-2 bottom-2 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-medium text-white tabular-nums">
              {timingLabel}
            </span>
          </div>

          {(onStatusChange || queueControl) && (
            <div className="flex flex-col items-stretch gap-2">
              {onStatusChange && (
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    aria-label={t(isWatched ? "markVideoNotWatched" : "markVideoWatched")}
                    aria-pressed={isWatched}
                    className={clsx(
                      isWatched &&
                        "bg-green-100 text-green-800 hover:bg-green-200 dark:bg-green-950 dark:text-green-300 dark:hover:bg-green-900",
                    )}
                    disabled={isUpdating}
                    onClick={() => onStatusChange({ watchedAt: isWatched ? null : new Date() })}
                    size="sm"
                    variant={isWatched ? "secondary" : "ghost"}
                  >
                    {isWatched ? (
                      <Icons.watched aria-hidden="true" />
                    ) : (
                      <Icons.notWatched aria-hidden="true" />
                    )}
                    {t("watched")}
                  </Button>
                  <Button
                    aria-label={t(isBookmarked ? "removeVideoBookmark" : "bookmarkVideo")}
                    aria-pressed={isBookmarked}
                    disabled={isUpdating}
                    onClick={() =>
                      onStatusChange({
                        bookmarkedAt: isBookmarked ? null : new Date(),
                      })
                    }
                    size="sm"
                    variant={isBookmarked ? "secondary" : "ghost"}
                  >
                    <Icons.bookmark
                      aria-hidden="true"
                      fill={isBookmarked ? "currentColor" : "none"}
                    />
                    {t("bookmarked")}
                  </Button>
                </div>
              )}
              {queueControl}
            </div>
          )}

          {video.watchedAt && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <time
                dateTime={video.watchedAt.toISOString()}
                title={fmtDate(video.watchedAt, locale)}
              >
                {t("watchedOn", { date: fmtListDate(video.watchedAt, locale) })}
              </time>
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-3 @3xl:min-h-full @3xl:border-l @3xl:border-border/60 @3xl:pl-5">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="flex min-w-0 grow flex-wrap items-center gap-x-1.5 gap-y-1">
              <span className="text-sm font-medium wrap-anywhere text-card-foreground">
                {author}
              </span>
              {showSource && video.source === "manual" && (
                <>
                  <span aria-hidden="true" className="text-xs text-muted-foreground/60">
                    ·
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Icons.manualVideo aria-hidden="true" size={12} />
                    {t("addedManually")}
                  </span>
                </>
              )}
              <span aria-hidden="true" className="text-xs text-muted-foreground/60">
                ·
              </span>
              <time
                className="text-xs whitespace-nowrap text-muted-foreground tabular-nums"
                dateTime={video.createdAt.toISOString()}
                title={fmtDate(video.createdAt, locale)}
              >
                {fmtListDate(video.createdAt, locale)}
              </time>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <strong className="text-base font-semibold text-card-foreground tabular-nums">
                {video.queueAmount === null
                  ? t("queueAmountUnavailable")
                  : fmtAmount(
                      video.queueAmount,
                      CurrencyCodeSchema.parse(video.queueCurrency),
                      locale,
                    )}
              </strong>
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

          <div className="flex min-w-0 flex-col gap-2">
            {video.title !== null && (
              <h3 className="font-heading text-lg leading-snug font-semibold wrap-anywhere text-card-foreground">
                {video.title}
              </h3>
            )}
            <div className="flex min-w-0 flex-nowrap items-center gap-1.5">
              {showPriorityLabel && (
                <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-secondary-foreground">
                  {video.priorityLabel ?? t("videoUnassigned")}
                </span>
              )}
              {!isEditing && (
                <span className="text-xs whitespace-nowrap text-muted-foreground">
                  {watchDuration === null
                    ? t(
                        video.metadataUnavailable
                          ? "videoDurationUnavailable"
                          : "videoDurationPending",
                      )
                    : t("watchDuration", watchDuration)}
                </span>
              )}
              {video.durationSeconds === null && onRetryMetadata && !isEditing && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        aria-label={t("videoRetryMetadata")}
                        disabled={isUpdating}
                        onClick={onRetryMetadata}
                        size="icon-xs"
                        type="button"
                        variant="ghost"
                      >
                        <Icons.retry aria-hidden="true" />
                      </Button>
                    }
                  />
                  <TooltipContent>{t("videoRetryMetadata")}</TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>

          {isEditing && (
            <FormProvider {...form}>
              <form
                className="flex flex-col gap-3 rounded-lg border border-border bg-muted/60 p-3"
                onSubmit={(event) => void handleSubmit(save)(event)}
              >
                <div className="grid gap-3 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                  <Field data-invalid={Boolean(formState.errors.amount)}>
                    <FieldLabel htmlFor={`video-amount-${video.videoId}`}>{t("amount")}</FieldLabel>
                    <Input
                      aria-describedby={formState.errors.amount ? amountErrorId : undefined}
                      aria-invalid={Boolean(formState.errors.amount)}
                      autoComplete="off"
                      className="bg-card dark:bg-card"
                      disabled={isUpdating}
                      id={`video-amount-${video.videoId}`}
                      min="0"
                      step="any"
                      type="number"
                      {...register("amount", {
                        required: t("enterPriorityAmount"),
                        validate: (value) =>
                          MoneyAmountSchema.safeParse(value).success || t("enterAmountZeroOrMore"),
                      })}
                    />
                    <FieldError errors={[formState.errors.amount]} id={amountErrorId} />
                  </Field>
                  <VideoTimingFields
                    allowOpenEnd
                    disabled={isUpdating}
                    maximumEndSeconds={video.durationSeconds}
                    showOpenEndHelp={false}
                  />
                </div>
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
            </FormProvider>
          )}

          {video.durationSeconds !== null && video.startSeconds >= video.durationSeconds && (
            <p className="text-xs text-destructive">{t("videoInvalidRange")}</p>
          )}
          {video.durationSeconds === null && onRetryMetadata && video.metadataRetryAt !== null && (
            <span className="text-xs text-muted-foreground">
              {t("videoNextRetry", {
                date: fmtListDate(video.metadataRetryAt, locale),
              })}
            </span>
          )}

          {video.source === "donation" ? (
            <>
              <p className="min-w-0 text-sm leading-relaxed wrap-anywhere text-card-foreground">
                {messageChunks.map((chunk, index) => {
                  if (chunk.type === "string") {
                    return <span key={index}>{chunk.value}</span>;
                  }

                  const isVideoLink = normalizeUrl(chunk.href) === normalizeUrl(video.url);

                  return (
                    <a
                      className={
                        isVideoLink
                          ? "rounded-sm font-medium text-primary underline decoration-primary/30 underline-offset-4 hover:decoration-primary focus-visible:outline-2 focus-visible:outline-ring"
                          : "rounded-sm text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
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
              <Link
                className="inline-flex w-fit items-center gap-1 rounded text-xs text-muted-foreground underline-offset-4 hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                to="/donations"
                search={{
                  donationId: video.donation.donationId.toString(),
                  page: 1,
                  period: "all",
                  query: "",
                }}
              >
                {t("goToDonation")}
              </Link>
            </>
          ) : (
            <a
              className="inline-flex w-fit items-center gap-1 rounded-sm text-xs text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
              href={video.url}
              rel="noreferrer"
              target="_blank"
            >
              <Icons.externalLink aria-hidden="true" size={13} />
              {t("openOnYoutube")}
            </a>
          )}
        </div>
      </div>
    </article>
  );
}
