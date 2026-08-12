import { fmtAmount, fmtDate, formatRelativeDate } from "@client/lib/fmt";
import { Video } from "@omnistream/server";
import { clsx } from "clsx";
import { Check, CheckCircle2, Circle, Pencil, X } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { useTextWithLinks } from "../hooks/use-text-with-links";
import { Icons } from "./icons";
import { Button } from "./ui/button";

type Props = {
  video: Video;
  onStatusChange?: (status: { watchedAt?: Date | null; savedAt?: Date | null }) => void;
  onUpdate?: (input: { amount: number; durationMinutes: number }) => Promise<void>;
  isUpdating?: boolean;
};

type VideoFormValues = {
  amount: number;
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

export default function VideoCard({
  video,
  onStatusChange,
  onUpdate,
  isUpdating = false,
}: Props) {
  const author = video.donation.author ?? "Anonymous";
  const messageChunks = useTextWithLinks(video.donation.message ?? "");
  const embedUrl = getYoutubeEmbedUrl(video.url);
  const isWatched = video.watchedAt !== null;
  const isSaved = video.savedAt !== null;
  const [isEditing, setIsEditing] = useState(false);
  const { formState, handleSubmit, register, reset } = useForm<VideoFormValues>({
    defaultValues: {
      amount: video.amount,
      durationMinutes: video.durationMinutes ?? 0,
    },
    mode: "onChange",
  });

  const startEditing = () => {
    reset({ amount: video.amount, durationMinutes: video.durationMinutes ?? 0 });
    setIsEditing(true);
  };

  const cancelEditing = () => {
    reset({ amount: video.amount, durationMinutes: video.durationMinutes ?? 0 });
    setIsEditing(false);
  };

  const save = async (input: VideoFormValues) => {
    if (!onUpdate) return;
    await onUpdate(input);
    setIsEditing(false);
  };

  return (
    <article className="flex flex-col gap-3 px-4 py-4 sm:px-5">
      <div className="flex items-start gap-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          {embedUrl && (
            <div className="relative aspect-video overflow-hidden rounded-lg bg-[#f0eff3] sm:w-60 sm:shrink-0">
              <iframe
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="size-full"
                loading="lazy"
                referrerPolicy="strict-origin-when-cross-origin"
                src={embedUrl}
                title={`YouTube video from ${author}`}
              />
              {video.durationMinutes !== null && (
                <span className="absolute right-2 bottom-2 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-medium text-white">
                  {video.durationMinutes} min
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex grow flex-col gap-3">
          <div className="flex items-center justify-between">
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
                dateTime={video.donation.createdAt.toISOString()}
                title={fmtDate(video.donation.createdAt)}
              >
                {formatRelativeDate(video.donation.createdAt)}
              </time>
            </div>

            <div className="flex shrink-0 items-start gap-2">
              <div className="flex flex-col items-end gap-0.5">
                <strong className="block text-[13px] text-[#3f3b50]">{fmtAmount(video.amount)}</strong>
                {!isEditing && (
                  <span className="text-xs text-[#777385]">
                    {video.durationMinutes === null ? "Unknown duration" : `${video.durationMinutes} min`}
                  </span>
                )}
              </div>
              {onUpdate && !isEditing && (
                <Button
                  aria-label="Edit video details"
                  disabled={isUpdating}
                  onClick={startEditing}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                >
                  <Pencil aria-hidden="true" />
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
                  <span className="text-xs font-medium text-[#454157] dark:text-[#e4dfed]">Amount</span>
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
                      required: "Enter a priority amount.",
                      valueAsNumber: true,
                      validate: (value) =>
                        (Number.isFinite(value) && value >= 0) || "Enter an amount of zero or more.",
                    })}
                  />
                  <span className="text-[11px] leading-snug text-[#777385]" id="video-amount-help">
                    Donation amount used to determine the video&apos;s priority.
                  </span>
                  {formState.errors.amount && (
                    <span className="text-[11px] text-red-600">{formState.errors.amount.message}</span>
                  )}
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-[#454157] dark:text-[#e4dfed]">Duration, min</span>
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
                      required: "Enter a duration.",
                      valueAsNumber: true,
                      validate: (value) =>
                        (Number.isInteger(value) && value >= 0) || "Enter a whole number of minutes.",
                    })}
                  />
                  <span className="text-[11px] leading-snug text-[#777385]" id="video-duration-help">
                    Video length in whole minutes; it is used when calculating the queue.
                  </span>
                  {formState.errors.durationMinutes && (
                    <span className="text-[11px] text-red-600">
                      {formState.errors.durationMinutes.message}
                    </span>
                  )}
                </label>
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button disabled={isUpdating} onClick={cancelEditing} size="sm" type="button" variant="outline">
                  <X aria-hidden="true" />
                  Cancel
                </Button>
                <Button disabled={!formState.isValid || isUpdating} size="sm" type="submit">
                  <Check aria-hidden="true" />
                  Save
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
          <div className="flex items-center gap-2">
            {onStatusChange && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  aria-label={isWatched ? "Mark video as not watched" : "Mark video as watched"}
                  className={clsx(isWatched && "bg-green-100 text-green-700 hover:bg-green-200")}
                  disabled={isUpdating}
                  onClick={() => onStatusChange({ watchedAt: isWatched ? null : new Date() })}
                  size="sm"
                  variant={isWatched ? "secondary" : "outline"}
                >
                  {isWatched ? <CheckCircle2 aria-hidden="true" /> : <Circle aria-hidden="true" />}
                  Watched
                </Button>
                <Button
                  aria-label={isSaved ? "Remove video from saved" : "Save video"}
                  className={clsx(isSaved && "bg-yellow-100 text-yellow-700 hover:bg-yellow-200")}
                  disabled={isUpdating}
                  onClick={() => onStatusChange({ savedAt: isSaved ? null : new Date() })}
                  size="sm"
                  variant={isSaved ? "secondary" : "outline"}
                >
                  <Icons.bookmark aria-hidden="true" fill={isSaved ? "currentColor" : "none"} />
                  Saved
                </Button>
              </div>
            )}

            {(video.watchedAt || video.savedAt) && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[#777385]">
                {video.watchedAt && (
                  <time dateTime={video.watchedAt.toISOString()} title={fmtDate(video.watchedAt)}>
                    Watched {fmtDate(video.watchedAt)}
                  </time>
                )}
                {video.savedAt && (
                  <time dateTime={video.savedAt.toISOString()} title={fmtDate(video.savedAt)}>
                    Saved {fmtDate(video.savedAt)}
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
