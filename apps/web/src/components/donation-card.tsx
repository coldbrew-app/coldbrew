import { Link } from "@tanstack/react-router";
import type { inferRouterOutputs } from "@trpc/server";
import { fmtAmount, fmtDate, fmtListDate } from "@web/lib/fmt";
import type { AppRouter } from "@web/server/api/trpc";
import type { Donation } from "@web/server/exports";
import { clsx } from "clsx";

import { useTextWithLinks } from "../hooks/use-text-with-links";
import { createI18n, useI18n } from "../lib/i18n";
import { DonationAlertsSourceBadge } from "./donation-alerts";
import { Icons } from "./icons";
import { buttonVariants } from "./ui/button";

const i18n = createI18n({
  donationVideosPending: {
    en: "Video links are awaiting processing",
    ru: "Ссылки на видео ожидают обработки",
  },
  donationVideoNumber: {
    en: ({ number }: { number: number }) => `Video ${number}`,
    ru: ({ number }: { number: number }) => `Видео ${number}`,
  },
  goToVideo: {
    en: "Go to video in queue",
    ru: "Перейти к видео в очереди",
  },
  anonymous: {
    en: "Anonymous",
    ru: "Аноним",
  },
  sentDonation: {
    en: "A donation was sent",
    ru: "Без сообщения",
  },
});

type Props = {
  className?: string;
  donation: Donation;
  expandMessage?: boolean;
  videoParsing?: Pick<
    inferRouterOutputs<AppRouter>["donationPage"]["items"][number],
    "videos" | "videosParsedAt"
  >;
};

function getInitials(author: string) {
  return author
    .split(/\s+/)
    .map((part) => part.at(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default function DonationCard({
  donation,
  videoParsing,
  expandMessage = false,
  ...props
}: Props) {
  const { locale, t } = useI18n(i18n);
  const author = donation.author ?? t("anonymous");
  const messageChunks = useTextWithLinks(donation.message ?? t("sentDonation"));

  return (
    <div
      className={clsx(
        "relative grid min-w-0 grid-cols-[36px_minmax(0,1fr)_auto] items-start gap-3 overflow-hidden px-4 py-4 sm:px-5",
        props.className,
      )}
    >
      <div className="relative grid size-9 shrink-0 place-items-center rounded-full border border-primary/15 bg-secondary text-[10px] font-bold text-secondary-foreground">
        {getInitials(author)}
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <strong className="text-[13px] text-card-foreground">{author}</strong>
          <DonationAlertsSourceBadge className="text-[9px]" />
        </div>
        <p
          className={clsx(
            "text-sm leading-6 break-words text-muted-foreground [overflow-wrap:anywhere]",
            !expandMessage && "line-clamp-3",
          )}
        >
          {messageChunks.map((chunk, index) =>
            chunk.type === "string" ? (
              <span key={index}>{chunk.value}</span>
            ) : (
              <a
                key={index}
                href={chunk.href}
                target="_blank"
                className="font-bold hover:underline"
              >
                {chunk.text}
              </a>
            ),
          )}
        </p>
        {videoParsing?.videosParsedAt === null && (
          <p className="text-xs text-muted-foreground">{t("donationVideosPending")}</p>
        )}
        {videoParsing && videoParsing.videos.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {videoParsing.videos.map((video, index) => (
              <Link
                className={buttonVariants({
                  variant: "secondary",
                  size: "sm",
                  className: "max-w-full rounded-full",
                })}
                key={video.videoId}
                title={video.title ?? t("goToVideo")}
                to="/videos"
                search={{
                  videoId: video.videoId.toString(),
                  page: 1,
                  videoPriorityId: "all",
                  videoStatus: "all",
                }}
              >
                <Icons.video aria-hidden="true" />
                <span className="truncate">
                  {video.title ?? t("donationVideoNumber", { number: index + 1 })}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
      <div className="shrink-0 text-right">
        <strong className="block text-sm font-semibold tabular-nums text-card-foreground">
          {fmtAmount(donation.amount, donation.currency, locale)}
        </strong>
        <time
          className="mt-1 block text-[10px] text-muted-foreground"
          dateTime={donation.occurredAt.toISOString()}
          title={fmtDate(donation.occurredAt, locale)}
        >
          {fmtListDate(donation.occurredAt, locale)}
        </time>
      </div>
    </div>
  );
}
