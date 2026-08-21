import { MoneyAmountSchema } from "@coldbrew/packages/schemas.js";
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
  onStatusChange?: (status: { watchedAt?: Date | null; savedAt?: Date | null }) => void;
  onUpdate?: (input: { amount: string; durationMinutes: number }) => Promise<void>;
  isUpdating?: boolean;
};

type VideoFormValues = {
  amount: string;
  durationMinutes: number;
};

const getYoutubeEmbedUrl = (url: string) => {
  const parsedUrl = new URL(url);
  const host = parsedUrl.hostname.replace(/^www\./, "").toLowerCase();
  const videoId =
    host === "youtu.be"
      ? parsedUrl.pathname.split("/")[1]
      : (parsedUrl.searchParams.get("v") ??
        parsedUrl.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/)?.[1]);

  return videoId ? `https://www.youtube-nocookie.com/embed/${videoId}` : null;
};

const normalizeUrl = (url: string) => {
  const parsedUrl = new URL(url.startsWith("www.") ? `https://${url}` : url);
  const pathname = parsedUrl.pathname.replace(/\/$/, "");

  return `${parsedUrl.hostname.toLowerCase()}${pathname}${parsedUrl.search}`;
};

export default function VideoCard({ video, onStatusChange, onUpdate, isUpdating = false }: Props) {
  const { locale, t } = useI18n();
  const author = video.donation.author ?? t("anonymous");
  const messageChunks = useTextWithLinks(video.donation.message ?? "");
  const embedUrl = getYoutubeEmbedUrl(video.url);
  const isWatched = video.watchedAt !== null;
  const isSaved = video.savedAt !== null;
  const [isEditing, setIsEditing] = useState(false);
  const { formState, handleSubmit, register, reset } = useForm<VideoFormValues>({
    defaultValues: {
      amount: video.queueMoney?.amount ?? "0.00",
      durationMinutes: video.durationMinutes,
    },
    mode: "onChange",
  });

  const startEditing = () => {
    reset({ amount: video.queueMoney?.amount ?? "0.00", durationMinutes: video.durationMinutes });
    setIsEditing(true);
  };

  const cancelEditing = () => {
    reset({ amount: video.queueMoney?.amount ?? "0.00", durationMinutes: video.durationMinutes });
    setIsEditing(false);
  };

  const save = async (input: VideoFormValues) => {
    if (!onUpdate) return;
    await onUpdate(input);
    setIsEditing(false);
  };

  return (
    <article className="flex flex-col gap-3 px-4 py-4 sm:px-5">
      <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-start">
        <div className="flex flex-col gap-3 sm:shrink-0">
          {embedUrl && (
            <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-[#f0eff3] sm:w-60">
              <iframe
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="size-full"
                loading="lazy"
                referrerPolicy="strict-origin-when-cross-origin"
                src={embedUrl}
                title={t("youtubeVideoFrom", { author })}
              />
              {video.durationMinutes !== null && (
                <span className="absolute right-2 bottom-2 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-medium text-white">
                  {t("minutes", { count: video.durationMinutes })}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex min-w-0 grow flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex min-w-0 grow items-center gap-3">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <strong className="text-[13px] text-[#454157]">{author}</strong>
                {video.priorityLabel && (
                  <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
                    {video.priorityLabel}
                  </span>
                )}
              </div>
              <time
                className="block text-[10px] text-[#aaa7b4]"
                dateTime={video.donation.occurredAt.toISOString()}
                title={fmtDate(video.donation.occurredAt, locale)}
              >
                {formatRelativeDate(video.donation.occurredAt, locale)}
              </time>
            </div>

            <div className="flex shrink-0 items-start gap-2">
              <div className="flex flex-col items-end gap-0.5">
                <strong className="block text-[13px] text-[#3f3b50]">
                  {fmtAmount(video.queueMoney ?? video.donation.money, locale)}
                </strong>
                {!isEditing && (
                  <span className="text-xs text-[#777385]">
                    {video.durationMinutes === null
                      ? t("unknownDuration")
                      : t("minutes", { count: video.durationMinutes })}
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
              className="flex flex-col gap-3 rounded-lg border border-violet-100 bg-violet-50/60 p-3 dark:border-violet-900/60 dark:bg-violet-950/20"
              onSubmit={(event) => void handleSubmit(save)(event)}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-[#454157] dark:text-[#e4dfed]">
                    {t("amount")}
                  </span>
                  <input
                    aria-describedby="video-amount-help"
                    aria-invalid={Boolean(formState.errors.amount)}
                    autoComplete="off"
                    className="h-8 w-full rounded-md border border-[#e5e3ea] bg-white px-2 text-sm text-[#353248] outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-[#4a4455] dark:bg-transparent dark:text-[#e4dfed]"
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
                  <span className="text-[11px] leading-snug text-[#777385]" id="video-amount-help">
                    {t("donationAmountHelp")}
                  </span>
                  {formState.errors.amount && (
                    <span className="text-[11px] text-red-600">
                      {formState.errors.amount.message}
                    </span>
                  )}
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-[#454157] dark:text-[#e4dfed]">
                    {t("durationMinutes")}
                  </span>
                  <input
                    aria-describedby="video-duration-help"
                    aria-invalid={Boolean(formState.errors.durationMinutes)}
                    autoComplete="off"
                    className="h-8 w-full rounded-md border border-[#e5e3ea] bg-white px-2 text-sm text-[#353248] outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-[#4a4455] dark:bg-transparent dark:text-[#e4dfed]"
                    disabled={isUpdating}
                    min="0"
                    step="1"
                    type="number"
                    {...register("durationMinutes", {
                      required: t("enterDuration"),
                      valueAsNumber: true,
                      validate: (value) =>
                        (Number.isInteger(value) && value >= 0) || t("enterWholeMinutes"),
                    })}
                  />
                  <span
                    className="text-[11px] leading-snug text-[#777385]"
                    id="video-duration-help"
                  >
                    {t("durationHelp")}
                  </span>
                  {formState.errors.durationMinutes && (
                    <span className="text-[11px] text-red-600">
                      {formState.errors.durationMinutes.message}
                    </span>
                  )}
                </label>
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
          )}
          <p className="min-w-0 grow text-xs leading-relaxed text-[#8e8b9b] sm:py-1">
            {messageChunks.map((chunk, index) => {
              if (chunk.type === "string") {
                return <span key={index}>{chunk.value}</span>;
              }

              const isVideoLink = normalizeUrl(chunk.href) === normalizeUrl(video.url);

              return (
                <a
                  className={
                    isVideoLink
                      ? "rounded bg-violet-100 px-1 py-0.5 font-semibold text-violet-700 hover:bg-violet-200"
                      : "font-semibold text-violet-600 hover:underline"
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
                  className={clsx(isSaved && "bg-yellow-100 text-yellow-700 hover:bg-yellow-200")}
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
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[#777385]">
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
