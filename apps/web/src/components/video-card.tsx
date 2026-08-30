import { CurrencyCodeSchema, MoneyAmountSchema } from "@coldbrew/packages/schemas.js";
import {
  formatVideoTime,
  getRoundedWatchDurationParts,
  getWatchDurationSeconds,
} from "@coldbrew/packages/video-timing.js";
import { rurl } from "@lebedevna/readonly-url";
import { fmtAmount, fmtDate, formatMoneyInputValue, formatRelativeDate } from "@web/lib/fmt";
import type { Video } from "@web/server/exports";
import { clsx } from "clsx";
import { useState } from "react";
import { FormProvider, useForm } from "react-hook-form";

import { useTextWithLinks } from "../hooks/use-text-with-links";
import { useI18n } from "../lib/i18n";
import { Icons } from "./icons";
import { Button } from "./ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { parseVideoTiming, VideoTimingFields, type VideoTimingValues } from "./video-timing-fields";

type Props = {
  video: Video;
  showPriorityLabel?: boolean;
  showSource?: boolean;
  onStatusChange?: (status: { watchedAt?: Date | null; bookmarkedAt?: Date | null }) => void;
  onUpdate?: (input: { amount: string; startSeconds: number; endSeconds: number }) => Promise<void>;
  isUpdating?: boolean;
};

type VideoFormValues = VideoTimingValues & {
  amount: string;
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

const normalizeUrl = (url: string) => {
  const parsedUrl = rurl(url.startsWith("www.") ? `https://${url}` : url);
  const pathname = parsedUrl.pathname.replace(/\/$/, "");

  return `${parsedUrl.hostname.toLowerCase()}${pathname}${parsedUrl.search}`;
};

export default function VideoCard({
  video,
  showPriorityLabel = true,
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
  const watchDuration = getRoundedWatchDurationParts(
    getWatchDurationSeconds(video.startSeconds, video.endSeconds),
  );
  const isWatched = video.watchedAt !== null;
  const isBookmarked = video.bookmarkedAt !== null;
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
  const amountErrorId = `video-amount-error-${video.videoId}`;
  const [isEditing, setIsEditing] = useState(false);
  const form = useForm<VideoFormValues>({
    defaultValues: {
      amount: formatMoneyInputValue(video.queueAmount ?? MoneyAmountSchema.parse("0.00")),
      startTime: formatVideoTime(video.startSeconds),
      endTime: formatVideoTime(video.endSeconds),
    },
    mode: "onChange",
  });
  const { formState, handleSubmit, register, reset } = form;

  const startEditing = () => {
    reset({
      amount: formatMoneyInputValue(video.queueAmount ?? MoneyAmountSchema.parse("0.00")),
      startTime: formatVideoTime(video.startSeconds),
      endTime: formatVideoTime(video.endSeconds),
    });
    setIsEditing(true);
  };

  const cancelEditing = () => {
    reset({
      amount: formatMoneyInputValue(video.queueAmount ?? MoneyAmountSchema.parse("0.00")),
      startTime: formatVideoTime(video.startSeconds),
      endTime: formatVideoTime(video.endSeconds),
    });
    setIsEditing(false);
  };

  const save = async (input: VideoFormValues) => {
    if (!onUpdate) return;
    const timing = parseVideoTiming(input, { allowOpenEnd: false });
    if (timing === null || timing.endSeconds === null) return;

    await onUpdate({ amount: input.amount, ...timing, endSeconds: timing.endSeconds });
    setIsEditing(false);
  };

  return (
    <article className="group relative flex flex-col gap-3 px-4 py-4 transition-colors hover:bg-secondary/25 sm:px-5">
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
                {showPriorityLabel && video.priorityLabel && (
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
                    {t("watchDuration", watchDuration)}
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
            <FormProvider {...form}>
              <form
                className="flex flex-col gap-3 rounded-lg border border-border bg-muted/60 p-3"
                onSubmit={(event) => void handleSubmit(save)(event)}
              >
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                  <Field data-invalid={Boolean(formState.errors.amount)}>
                    <FieldLabel htmlFor={`video-amount-${video.videoId}`}>{t("amount")}</FieldLabel>
                    <Input
                      aria-describedby={`${amountHelpId}${formState.errors.amount ? ` ${amountErrorId}` : ""}`}
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
                    <FieldDescription id={amountHelpId}>{t("queueAmountHelp")}</FieldDescription>
                    <FieldError errors={[formState.errors.amount]} id={amountErrorId} />
                  </Field>
                  <VideoTimingFields disabled={isUpdating} />
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
                  aria-label={t(isBookmarked ? "removeVideoBookmark" : "bookmarkVideo")}
                  disabled={isUpdating}
                  onClick={() => onStatusChange({ bookmarkedAt: isBookmarked ? null : new Date() })}
                  size="sm"
                  variant={isBookmarked ? "secondary" : "outline"}
                >
                  <Icons.bookmark
                    aria-hidden="true"
                    fill={isBookmarked ? "currentColor" : "none"}
                  />
                  {t("bookmarked")}
                </Button>
              </div>
            )}

            {(video.watchedAt || video.bookmarkedAt) && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                {video.watchedAt && (
                  <time
                    dateTime={video.watchedAt.toISOString()}
                    title={fmtDate(video.watchedAt, locale)}
                  >
                    {t("watchedOn", { date: fmtDate(video.watchedAt, locale) })}
                  </time>
                )}
                {video.bookmarkedAt && (
                  <time
                    dateTime={video.bookmarkedAt.toISOString()}
                    title={fmtDate(video.bookmarkedAt, locale)}
                  >
                    {t("bookmarkedOn", { date: fmtDate(video.bookmarkedAt, locale) })}
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
