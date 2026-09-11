import { cn } from "@web/lib/utils";

import { createI18n, useI18n } from "../lib/i18n";
import { DonationConnectionStatus } from "./donation-alerts";
import { Icons } from "./icons";

const i18n = createI18n({
  openDonationSource: {
    en: ({ source }: { source: string }) => `Open ${source}`,
    ru: ({ source }: { source: string }) => `Открыть ${source}`,
  },
});

export const DONATE_STREAM_NAME = "donate.stream";
const DONATE_STREAM_DONATIONS_URL = "https://lk.donate.stream/donate-alerts";

type MarkProps = {
  className?: string;
  size?: "sm" | "lg";
};

export function DonateStreamMark({ className, size = "sm" }: MarkProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center bg-linear-to-br from-sky-500 to-violet-600 font-bold text-white",
        size === "sm" ? "size-9 rounded-lg text-[11px]" : "size-12 rounded-xl text-sm shadow-sm",
        className,
      )}
    >
      d·s
    </div>
  );
}

export const DonateStreamConnectionStatus = DonationConnectionStatus;

export function DonateStreamSourceBadge({ className }: { className?: string }) {
  const { t } = useI18n(i18n);

  return (
    <a
      aria-label={t("openDonationSource", { source: DONATE_STREAM_NAME })}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border bg-background/70 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground transition-colors outline-none hover:border-primary/30 hover:bg-secondary hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
      href={DONATE_STREAM_DONATIONS_URL}
      rel="noopener noreferrer"
      target="_blank"
    >
      {DONATE_STREAM_NAME}
      <Icons.externalLink aria-hidden="true" size={10} />
    </a>
  );
}
