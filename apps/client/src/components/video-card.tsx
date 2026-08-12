import { fmtAmount, fmtDate, fmtDuration, formatRelativeDate } from "@client/lib/fmt";
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
  onAmountChange?: (amount: number) => Promise<void>;
  isUpdating?: boolean;
};

type VideoAmountFormValues = {
  amount: number;
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
  onAmountChange,
  isUpdating = false,
}: Props) {
  const author = video.donation.author ?? "Anonymous";
  const messageChunks = useTextWithLinks(video.donation.message ?? "");
  const embedUrl = getYoutubeEmbedUrl(video.url);
  const isWatched = video.watchedAt !== null;
  const isSaved = video.savedAt !== null;
  const [isEditingAmount, setIsEditingAmount] = useState(false);
  const { formState, handleSubmit, register, reset } = useForm<VideoAmountFormValues>({
    defaultValues: { amount: video.amount },
    mode: "onChange",
  });

  const startEditingAmount = () => {
    reset({ amount: video.amount });
    setIsEditingAmount(true);
  };

  const cancelEditingAmount = () => {
    reset({ amount: video.amount });
    setIsEditingAmount(false);
  };

  const saveAmount = async ({ amount }: VideoAmountFormValues) => {
    if (!onAmountChange) return;
    await onAmountChange(amount);
    setIsEditingAmount(false);
  };

  return (
    <article className="flex flex-col gap-3 px-4 py-4 sm:px-5">
      <div className="flex gap-4">
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
              {video.durationSeconds !== null && (
                <span className="absolute right-2 bottom-2 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-medium text-white">
                  {fmtDuration(video.durationSeconds)}
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

            <div className="flex shrink-0 items-center gap-2">
              {isEditingAmount ? (
                <form
                  className="flex items-center gap-1"
                  onSubmit={(event) => void handleSubmit(saveAmount)(event)}
                >
                  <label className="w-20">
                    <span className="sr-only">Video priority amount</span>
                    <input
                      aria-invalid={Boolean(formState.errors.amount)}
                      autoComplete="off"
                      className="h-7 w-full rounded-md border border-[#e5e3ea] bg-transparent px-2 text-right text-xs text-[#353248] outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-[#4a4455] dark:text-[#e4dfed]"
                      disabled={isUpdating}
                      min="0"
                      step="any"
                      type="number"
                      {...register("amount", {
                        required: "Enter a priority amount.",
                        valueAsNumber: true,
                        validate: (value) =>
                          (Number.isFinite(value) && value >= 0) ||
                          "Enter an amount of zero or more.",
                      })}
                    />
                  </label>
                  <Button
                    aria-label="Save priority amount"
                    disabled={!formState.isValid || isUpdating}
                    size="icon-xs"
                    type="submit"
                  >
                    <Check aria-hidden="true" />
                  </Button>
                  <Button
                    aria-label="Cancel editing priority amount"
                    disabled={isUpdating}
                    onClick={cancelEditingAmount}
                    size="icon-xs"
                    type="button"
                    variant="outline"
                  >
                    <X aria-hidden="true" />
                  </Button>
                </form>
              ) : (
                <>
                  <strong className="block text-[13px] text-[#3f3b50]">
                    {fmtAmount(video.amount)}
                  </strong>
                  {onAmountChange && (
                    <Button
                      aria-label="Edit priority amount"
                      disabled={isUpdating}
                      onClick={startEditingAmount}
                      size="icon-xs"
                      type="button"
                      variant="ghost"
                    >
                      <Pencil aria-hidden="true" />
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
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
