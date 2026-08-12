import { fmtAmount, fmtDate, formatRelativeDate } from "@client/lib/fmt";
import { Donation } from "@omnistream/server";
import { clsx } from "clsx";

import { useTextWithLinks } from "../hooks/use-text-with-links";
import { useI18n } from "../lib/i18n";

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
    <div className={clsx("flex gap-3 px-4 py-4 sm:items-center sm:px-5", props.className)}>
      <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-violet-100 text-[10px] font-bold text-violet-700">
        {getInitials(author)}
      </div>
      <div className="min-w-0 grow">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <strong className="text-[13px] text-[#454157]">{author}</strong>
          <span className="rounded bg-[#f0edf7] px-1.5 py-0.5 text-[9px] font-semibold text-[#8d899b]">
            DonationAlerts
          </span>
        </div>
        <p className="mt-1 truncate text-xs text-[#8e8b9b]">
          {messageChunks.map((chunk, index) =>
            chunk.type == "string" ? (
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
        <strong className="block text-[13px] text-[#3f3b50]">
          {fmtAmount(donation.amount, locale)}
        </strong>
        <time
          className="mt-1 block text-[10px] text-[#aaa7b4]"
          dateTime={donation.createdAt.toISOString()}
          title={fmtDate(donation.createdAt, locale)}
        >
          {formatRelativeDate(donation.createdAt, locale)}
        </time>
      </div>
    </div>
  );
}
