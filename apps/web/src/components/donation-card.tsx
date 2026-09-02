import { fmtAmount, fmtDate, formatRelativeDate } from "@web/lib/fmt";
import type { Donation } from "@web/server/exports";
import { clsx } from "clsx";

import { useTextWithLinks } from "../hooks/use-text-with-links";
import { useI18n } from "../lib/i18n";
import { DonationAlertsSourceBadge } from "./donation-alerts";

type Props = {
  className?: string;
  donation: Donation;
};

function getInitials(author: string) {
  return author
    .split(/\s+/)
    .map((part) => part.at(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default function DonationCard({ donation, ...props }: Props) {
  const { locale, t } = useI18n();
  const author = donation.author ?? t("anonymous");
  const messageChunks = useTextWithLinks(donation.message ?? t("sentDonation"));

  return (
    <div
      className={clsx(
        "group relative flex min-w-0 overflow-hidden gap-3 px-4 py-4 transition-colors hover:bg-secondary/35 sm:items-center sm:px-5",
        props.className,
      )}
    >
      <div className="relative grid size-9 shrink-0 place-items-center rounded-xl border border-primary/10 bg-secondary text-[10px] font-bold text-secondary-foreground transition-transform group-hover:-rotate-3 group-hover:scale-105">
        {getInitials(author)}
      </div>
      <div className="min-w-0 grow">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <strong className="text-[13px] text-card-foreground">{author}</strong>
          <DonationAlertsSourceBadge className="text-[9px]" />
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground">
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
      </div>
      <div className="shrink-0 text-right">
        <strong className="block text-[13px] text-card-foreground">
          {fmtAmount(donation.amount, donation.currency, locale)}
        </strong>
        <time
          className="mt-1 block text-[10px] text-muted-foreground"
          dateTime={donation.occurredAt.toISOString()}
          title={fmtDate(donation.occurredAt, locale)}
        >
          {formatRelativeDate(donation.occurredAt, locale)}
        </time>
      </div>
    </div>
  );
}
